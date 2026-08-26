import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Translator } from '@nuvix/i18n'
import { Resvg } from '@resvg/resvg-js'
import QRCode from 'qrcode'
import { NotFoundError } from '../shared/errors'

/**
 * Avatars module — image generation/serving.
 * Contract: docs/api/avatars.md
 *
 * Services are pure: they return `{ body, contentType, headers }`; the route
 * layer converts to a Response. Bun.Image replaces sharp (D21).
 */

const ASSETS_DIR = new URL('../../../../assets/avatars/', import.meta.url).pathname
const FONT_FILE = new URL('../../../../assets/fonts/Varela-Regular.ttf', import.meta.url).pathname

export type AvatarSet = 'flags' | 'browsers' | 'credit-cards'

const CODE_RE = /^[a-z0-9-]+$/i
const MAX_DIM = 2000

const clampDim = (v: number | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(MAX_DIM, Math.max(1, Math.trunc(n))) : fallback
}

/** Scan an asset directory once; code = filename without extension. */
async function loadSet(dir: string): Promise<Set<string>> {
  const entries = await readdir(path.join(ASSETS_DIR, dir))
  return new Set(entries.map((f) => path.basename(f, path.extname(f)).toLowerCase()))
}

export interface AvatarResult {
  body: Uint8Array
  contentType: string
  headers: Record<string, string>
}

const AVATAR_CACHE = { 'Cache-Control': 'public, max-age=86400, immutable' }
const FAVICON_CACHE = { 'Cache-Control': 'public, max-age=3600' }

export function createAvatarService() {
  // Loaded eagerly at startup — ~425 tiny stat calls, negligible.
  const sets = {
    flags: loadSet('flags'),
    browsers: loadSet('browsers'),
    'credit-cards': loadSet('credit-cards'),
  }

  async function assertCode(set: AvatarSet, code: string): Promise<string> {
    if (!CODE_RE.test(code)) {
      throw new NotFoundError('Unknown avatar code', {
        messageKey: 'errors.avatars.unknownCode',
        params: { code },
      })
    }
    const normalized = code.toLowerCase()
    if (!(await sets[set]).has(normalized)) {
      throw new NotFoundError('Unknown avatar code', {
        messageKey: 'errors.avatars.unknownCode',
        params: { code },
      })
    }
    return normalized
  }

  /** Resize a static asset to exact dimensions via the Bun.Image pipeline. */
  async function resize(
    set: AvatarSet,
    code: string,
    width: number,
    height: number,
  ): Promise<AvatarResult> {
    const normalized = await assertCode(set, code)
    const file = Bun.file(path.join(ASSETS_DIR, set, `${normalized}.png`))
    const body = await file.image().resize(width, height, { fit: 'fill' }).png().bytes()
    return { body, contentType: 'image/png', headers: AVATAR_CACHE }
  }

  function getInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return 'NA'
    const first = Array.from(words[0]!)[0]?.toUpperCase() ?? 'N'
    const second =
      words.length > 1
        ? Array.from(words[1]!)[0]?.toUpperCase()
        : Array.from(words[0]!)[1]?.toUpperCase()
    return (first + (second ?? '')).slice(0, 2)
  }

  function hslFromName(name: string): string {
    let hash = 2166136261
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i)
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    hash >>>= 0
    return `hsl(${hash % 360}, 65%, 55%)`
  }

  function initialsSVG(
    initials: string,
    width: number,
    height: number,
    background: string,
    circle: boolean,
  ): string {
    const safe = initials
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
    const size = Math.min(width, height)
    const fontSize = safe.length === 1 ? size * 0.55 : safe.length === 2 ? size * 0.45 : size * 0.35
    const radius = size / 2 - 1
    const shape = circle
      ? `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="${background}" />`
      : `<rect width="100%" height="100%" fill="${background}" />`
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${shape}
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="#ffffff"
    font-family="Varela, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${safe}</text>
</svg>`
  }

  /** Render initials avatar: SVG template -> resvg -> PNG. */
  async function initials(opts: {
    name?: string
    width?: number
    height?: number
    background?: string
    circle?: boolean
  }): Promise<AvatarResult> {
    // v1 parity: missing/empty name renders "NA".
    const name = opts.name?.trim() ? opts.name : 'NA'
    const width = clampDim(opts.width, 500)
    const height = clampDim(opts.height, 500)

    const hex = opts.background?.replace(/[^0-9a-fA-F]/g, '')
    const background = hex && (hex.length === 3 || hex.length === 6) ? `#${hex}` : hslFromName(name)

    const svg = initialsSVG(getInitials(name), width, height, background, !!opts.circle)
    const png = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        defaultFontFamily: 'Varela, Arial, sans-serif',
        fontFiles: [FONT_FILE],
      },
    })
      .render()
      .asPng()

    return {
      body: new Uint8Array(png),
      contentType: 'image/png',
      headers: AVATAR_CACHE,
    }
  }

  const clampRange = (v: number | undefined, fallback: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
  }

  async function qr(
    text: string,
    size: number,
    margin: number,
    download: boolean,
  ): Promise<AvatarResult> {
    const buffer = await QRCode.toBuffer(text, {
      type: 'png',
      width: clampRange(size, 400, 1, 1000),
      margin: clampRange(margin, 1, 0, 10),
    })
    const headers: Record<string, string> = {
      ...AVATAR_CACHE,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="qr.png"`,
    }
    return { body: new Uint8Array(buffer), contentType: 'image/png', headers }
  }

  // --- Favicon proxy -------------------------------------------------------

  const PRIVATE_HOST_RE =
    /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i

  /**
   * Fetch a remote favicon and re-encode as PNG.
   * SSRF hardening per contract: http(s) only, private/loopback hosts rejected,
   * response must be an image. Full DNS-based pinning lands with the
   * network-hardening pass.
   */
  async function favicon(url: string): Promise<AvatarResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new NotFoundError('Favicon unavailable', {
        messageKey: 'errors.avatars.faviconUnavailable',
      })
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      PRIVATE_HOST_RE.test(parsed.hostname)
    ) {
      throw new NotFoundError('Favicon unavailable', {
        messageKey: 'errors.avatars.faviconUnavailable',
      })
    }

    let response: Response
    try {
      response = await fetch(parsed, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'image/*' },
      })
    } catch {
      throw new NotFoundError('Favicon unavailable', {
        messageKey: 'errors.avatars.faviconUnavailable',
      })
    }

    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      throw new NotFoundError('Favicon unavailable', {
        messageKey: 'errors.avatars.faviconUnavailable',
      })
    }

    try {
      const bytes = await response.bytes()
      const body = await new Blob([bytes]).image().resize(256, 256, { fit: 'inside' }).png().bytes()
      return { body, contentType: 'image/png', headers: FAVICON_CACHE }
    } catch {
      throw new NotFoundError('Favicon unavailable', {
        messageKey: 'errors.avatars.faviconUnavailable',
      })
    }
  }

  return { resize, initials, qr, favicon }
}

export type AvatarService = ReturnType<typeof createAvatarService>

/** Shared translator type re-export for route typing convenience. */
export type { Translator }

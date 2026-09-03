import { BadRequestError } from '../shared/errors'

/**
 * IPv4 CIDR ranges that must never be reachable via user-supplied webhook URLs.
 * Includes loopback, private, carrier-grade NAT, link-local (cloud metadata), and reserved ranges.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8       - "this network"
  [0x0a000000, 8], // 10.0.0.0/8      - private
  [0x64400000, 10], // 100.64.0.0/10   - carrier-grade NAT
  [0x7f000000, 8], // 127.0.0.0/8     - loopback
  [0xa9fe0000, 16], // 169.254.0.0/16  - link-local (cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12   - private
  [0xc0000000, 24], // 192.0.0.0/24    - IETF protocol assignments
  [0xc0a80000, 16], // 192.168.0.0/16  - private
  [0xc6120000, 15], // 198.18.0.0/15   - benchmarking
]

function isBlockedIPv4Value(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (base & mask)
  })
}

function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true // malformed -> treat as blocked
  }

  const value = octets.reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0)
  return isBlockedIPv4Value(value)
}

function expandIPv6(host: string): number[] | null {
  const parts = host.split('::')
  if (parts.length > 2) {
    return null
  }
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0) {
    return null
  }
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  if (groups.length !== 8) {
    return null
  }
  const nums = groups.map((g) => Number.parseInt(g, 16))
  if (nums.some((n) => Number.isNaN(n))) {
    return null
  }
  return nums
}

function isBlockedIPv6(host: string): boolean {
  const mappedIp = host.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1]
  if (mappedIp) {
    return isBlockedIPv4(mappedIp)
  }

  const groups = expandIPv6(host)
  if (!groups) {
    return true // unparseable -> treat as blocked
  }

  // Unspecified (::) and loopback (::1)
  if (groups.every((g) => g === 0)) {
    return true
  }
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
    return true
  }

  // IPv4-mapped ::ffff:a00:1 (hex-normalized form)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const value = (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0
    return isBlockedIPv4Value(value)
  }

  const first = groups[0] ?? 0
  // Unique-local fc00::/7 and link-local fe80::/10
  return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf)
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }

  if (host.includes(':')) {
    return isBlockedIPv6(host)
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isBlockedIPv4(host)
  }

  return false
}

export function validateWebhookUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new BadRequestError('Webhook URL must be a valid string up to 2048 characters', {
      code: 'invalid_webhook_url',
    })
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BadRequestError('Webhook URL is not a valid URL', {
      code: 'invalid_webhook_url',
    })
  }

  const scheme = url.protocol.replace(':', '')
  if (scheme !== 'http' && scheme !== 'https') {
    throw new BadRequestError('Webhook URL must use http or https scheme', {
      code: 'invalid_webhook_url',
    })
  }

  if (url.username || url.password) {
    throw new BadRequestError(
      'Webhook URL cannot contain embedded credentials; use httpUser and httpPass',
      { code: 'invalid_webhook_url' },
    )
  }

  if (isBlockedHost(url.hostname)) {
    throw new BadRequestError(
      'Webhook URL points to a blocked, local, or private network address',
      { code: 'webhook_url_blocked' },
    )
  }

  return value
}

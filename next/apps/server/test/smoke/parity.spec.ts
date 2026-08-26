/**
 * Behavioral smoke harness — boots the REAL composed app (not a probe) and
 * runs every case in ./cases.ts against it via app.handle().
 *
 * v2 assertions are hard failures. When NUVIX_V1_BASE_URL is set (e.g.
 * `NUVIX_V1_BASE_URL=http://localhost:3000 bun test test/smoke`), each case
 * is additionally replayed against the live old app and a normalized
 * side-by-side report is printed after the run. The v1 comparison is
 * informational: contracts intentionally differ, the report exists to make
 * behavioral drift visible during migration review.
 */
process.env.NUVIX_INTERNAL_DATABASE_URL ??= 'postgres://localhost:5432/nuvix'
process.env.NUVIX_JWT_SECRET ??= 'smoke-test-secret'
process.env.NUVIX_REDIS_URL ??= 'redis://localhost:6379'

import { afterAll, describe, expect, test } from 'bun:test'
import { cases, type ParityCase } from './cases'

// Dynamic import AFTER the env defaults above: config fail-fasts at module
// load, and static imports would hoist past the assignments.
const { app } = await import('../../src/app')

const V1_BASE = process.env.NUVIX_V1_BASE_URL

/** Normalized, comparable outcome for one response. */
interface Signature {
  status: number
  contentTypePrefix: string
  cacheControl: string | null
  jsonKeys: string[] | null
}

async function signature(res: Response): Promise<Signature> {
  const contentType = res.headers.get('content-type') ?? ''
  let jsonKeys: string[] | null = null
  if (contentType.startsWith('application/json') || contentType.includes('+json')) {
    jsonKeys = Object.keys((await res.json()) as object).sort()
  }
  return {
    status: res.status,
    contentTypePrefix: contentType.split(';')[0]!,
    cacheControl: res.headers.get('cache-control'),
    jsonKeys,
  }
}

function buildUrl(case_: ParityCase, base: string): string {
  const url = new URL(case_.path, base)
  for (const [key, value] of Object.entries(case_.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

interface V1Comparison {
  name: string
  verdict: 'match' | 'diff' | 'error'
  detail?: string
}

const v1Results: V1Comparison[] = []

async function compareWithV1(case_: ParityCase): Promise<V1Comparison> {
  const v1Path = case_.v1Path ?? case_.path.replace('/v2/', '/v1/')
  try {
    const [v2Res, v1Res] = await Promise.all([
      app.handle(
        new Request(buildUrl(case_, 'http://nuvix.test'), {
          method: case_.method ?? 'GET',
          headers: case_.headers,
        }),
      ),
      fetch(buildUrl({ ...case_, path: v1Path }, V1_BASE!), {
        method: case_.method ?? 'GET',
        headers: case_.headers,
      }),
    ])
    const [v2Sig, v1Sig] = await Promise.all([signature(v2Res), signature(v1Res)])
    const diffs: string[] = []
    if (v2Sig.status !== v1Sig.status) diffs.push(`status ${v2Sig.status} vs ${v1Sig.status}`)
    if (v2Sig.contentTypePrefix !== v1Sig.contentTypePrefix) {
      diffs.push(`content-type ${v2Sig.contentTypePrefix} vs ${v1Sig.contentTypePrefix}`)
    }
    if (v2Sig.jsonKeys && v1Sig.jsonKeys && v2Sig.jsonKeys.join() !== v1Sig.jsonKeys.join()) {
      diffs.push(`json keys [${v2Sig.jsonKeys}] vs [${v1Sig.jsonKeys}]`)
    }
    if ((v2Sig.cacheControl ?? '') !== (v1Sig.cacheControl ?? '')) {
      diffs.push(`cache-control ${v2Sig.cacheControl} vs ${v1Sig.cacheControl}`)
    }
    return diffs.length === 0
      ? { name: case_.name, verdict: 'match' }
      : { name: case_.name, verdict: 'diff', detail: diffs.join('; ') }
  } catch (error) {
    return { name: case_.name, verdict: 'error', detail: String(error) }
  }
}

afterAll(async () => {
  if (!V1_BASE || v1Results.length === 0) return
  const matches = v1Results.filter((r) => r.verdict === 'match').length
  console.log(`\n── v1 parity report (${V1_BASE}) ─────────────────────────`)
  for (const r of v1Results) {
    const mark = r.verdict === 'match' ? '✓' : r.verdict === 'diff' ? '~' : '!'
    console.log(`${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`── ${matches}/${v1Results.length} normalized behaviors match ──\n`)
})

describe('smoke: real-app behavioral parity', () => {
  for (const c of cases) {
    test(c.name, async () => {
      // Arrange
      const request = new Request(buildUrl(c, 'http://nuvix.test'), {
        method: c.method ?? 'GET',
        headers: c.headers,
      })

      // Act
      const res = await app.handle(request)

      // Assert — status & headers
      expect(res.status).toBe(c.status)
      if (c.contentType)
        expect(res.headers.get('content-type')!.startsWith(c.contentType)).toBe(true)
      if (c.cacheControl) expect(res.headers.get('cache-control')).toBe(c.cacheControl)
      if (c.contentDisposition) {
        expect(res.headers.get('content-disposition')!.startsWith(c.contentDisposition)).toBe(true)
      }

      // Assert — body semantics
      const contentType = res.headers.get('content-type') ?? ''
      const isJson = contentType.startsWith('application/json') || contentType.includes('+json')
      if (!isJson) {
        expect(await res.bytes().then((b) => b.length > 0)).toBe(true)
      } else {
        const json = (await res.json()) as Record<string, unknown>
        if (c.jsonKeys) expect(Object.keys(json).sort()).toEqual([...c.jsonKeys].sort())
        if (c.problemType) expect(json.type).toBe(c.problemType)
        if (c.problemCode) expect(json.code).toBe(c.problemCode)
        if (c.envelope?.totalEqualsData) {
          const data = json.data as unknown[]
          const total = (json.meta as { total: number }).total
          expect(total).toBe(data.length)
        }
        if (c.envelope?.dataKeys) {
          const expected = [...c.envelope.dataKeys].sort()
          for (const item of json.data as Array<Record<string, unknown>>) {
            expect(Object.keys(item).sort()).toEqual(expected)
          }
        }
        if (c.envelope?.totalMin !== undefined) {
          expect((json.meta as { total: number }).total).toBeGreaterThanOrEqual(c.envelope.totalMin)
        }
        if (c.assertJson) expect(c.assertJson(json)).toBeNull()
      }

      // Informational replay against the old app when configured
      if (V1_BASE && c.v1Path !== null) v1Results.push(await compareWithV1(c))
    })
  }
})

import { describe, expect, test } from 'bun:test'
import { None } from '@nuvix/cache'
import { Database, Doc, SQLiteAdapter } from '@nuvix/db'
import { provisionPlatformDatabase } from '../src/infrastructure/database-provisioning'
import { PLATFORM_PERSISTENCE_MODEL } from '../src/infrastructure/platform-persistence-model'
import { createTenantTargetResolver } from '../src/infrastructure/tenant-database-target'
import {
  createTenantTargetFilters,
  TenantTargetCodecConfigurationError,
  TenantTargetCodecDecodeError,
} from '../src/infrastructure/tenant-target-codec'

const TARGET = Object.freeze({
  driver: 'postgresql' as const,
  connectionString: 'postgresql://nuvix_admin:target-secret@tenant.example.test/project_a',
})

function key(fill: number): string {
  const raw = new Uint8Array(32).fill(fill)
  let binary = ''
  for (const byte of raw) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function tamper(ciphertext: string): string {
  const replacement = ciphertext.endsWith('A') ? 'B' : 'A'
  return `${ciphertext.slice(0, -1)}${replacement}`
}

describe('tenant target codec', () => {
  test('round-trips a strict target through instance-local database filters and stores ciphertext', async () => {
    const filters = await createTenantTargetFilters(key(1))
    const adapter = new SQLiteAdapter(':memory:')
    const cache = new None()
    const database = new Database(adapter, cache)

    try {
      await provisionPlatformDatabase(database, 'sqlite', {
        tenantTargetFilters: filters,
      })
      const system = database.system()
      const id = 'target_project_a'
      const created = await system.createDocument(
        PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets,
        new Doc({
          $id: id,
          projectId: 'project_a',
          target: TARGET,
        }),
      )
      const stored = await database.skipFilters(() =>
        system.getDocument(PLATFORM_PERSISTENCE_MODEL.collections.tenantTargets, id),
      )
      const ciphertext: unknown = stored.get(PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.target)
      const decodedTarget: unknown = created.get(
        PLATFORM_PERSISTENCE_MODEL.fields.tenantTargets.target,
      )
      const resolved = await createTenantTargetResolver(system).resolve('project_a')

      expect(decodedTarget).toEqual(TARGET)
      expect(typeof ciphertext).toBe('string')
      expect(String(ciphertext)).toMatch(/^ntt1\./)
      expect(String(ciphertext)).not.toContain(TARGET.connectionString)
      expect(resolved).toEqual(TARGET)
      expect(Object.isFrozen(resolved)).toBe(true)
    } finally {
      await cache.close()
      await adapter.$client.disconnect()
    }
  })

  test('uses a fresh authenticated-encryption nonce for each encoding', async () => {
    const filters = await createTenantTargetFilters(key(2))
    const plaintext = JSON.stringify(TARGET)

    const first = await filters.encrypt.encode(plaintext)
    const second = await filters.encrypt.encode(plaintext)

    expect(first).not.toBe(second)
    expect(await filters.encrypt.decode(first)).toBe(plaintext)
    expect(await filters.encrypt.decode(second)).toBe(plaintext)
    expect(Object.keys(filters)).toEqual(['json', 'encrypt'])
    expect([filters, filters.json, filters.encrypt].every(Object.isFrozen)).toBe(true)
  })

  test('rejects tampering and wrong keys with the same redacted decode error', async () => {
    const filters = await createTenantTargetFilters(key(3))
    const wrongKeyFilters = await createTenantTargetFilters(key(4))
    const ciphertext = await filters.encrypt.encode(JSON.stringify(TARGET))

    for (const decode of [
      () => filters.encrypt.decode(tamper(ciphertext)),
      () => wrongKeyFilters.encrypt.decode(ciphertext),
    ]) {
      const failure = await decode().catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(TenantTargetCodecDecodeError)
      expect((failure as TenantTargetCodecDecodeError).code).toBe(
        'tenant_target_codec_decode_failed',
      )
      expect((failure as Error).message).toBe('Tenant target decoding failed')
      expect(String(failure)).not.toContain(TARGET.connectionString)
      expect(String(failure)).not.toContain(key(3))
      expect(String(failure)).not.toContain(key(4))
    }
  })

  test('rejects malformed and legacy payloads without decoding plaintext compatibility formats', async () => {
    const filters = await createTenantTargetFilters(key(5))
    const sensitive = TARGET.connectionString
    const malformedJson = await filters.encrypt.encode(`{"connectionString":"${sensitive}"`)

    const malformedCiphertexts = await Promise.all(
      [JSON.stringify(TARGET), `v1:${btoa(sensitive)}`, 'ntt1.not-canonical='].map((value) =>
        filters.encrypt.decode(value).catch((error: unknown) => error),
      ),
    )
    const plaintext = await filters.encrypt.decode(malformedJson)
    const malformedPlaintext = (() => {
      try {
        return filters.json.decode(plaintext)
      } catch (error) {
        return error
      }
    })()

    expect(
      malformedCiphertexts.every((failure) => failure instanceof TenantTargetCodecDecodeError),
    ).toBe(true)
    expect(malformedPlaintext).toBeInstanceOf(TenantTargetCodecDecodeError)
    expect(malformedCiphertexts.map(String).join(' ')).not.toContain(sensitive)
    expect(String(malformedPlaintext)).not.toContain(sensitive)
  })

  test.each([undefined, '', 'legacy-passphrase', key(6).slice(1), `${key(6)}=`])(
    'requires one canonical unpadded base64url-encoded 256-bit key',
    async (material) => {
      const failure = await createTenantTargetFilters(material).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(TenantTargetCodecConfigurationError)
      expect((failure as TenantTargetCodecConfigurationError).code).toBe(
        'tenant_target_codec_configuration_invalid',
      )
      expect((failure as Error).message).toBe('Tenant target codec configuration is invalid')
      if (material) expect(String(failure)).not.toContain(material)
    },
  )
})

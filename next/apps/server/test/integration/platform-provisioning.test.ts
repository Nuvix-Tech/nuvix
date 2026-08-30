import { describe, expect, test } from 'bun:test'
import {
  createPlatformDatabase,
  type PlatformDatabaseOwner,
} from '../../src/infrastructure/platform-database'
import { createPlatformProjectLookup } from '../../src/infrastructure/platform-projects'
import { createTenantTargetResolver } from '../../src/infrastructure/tenant-database-target'
import {
  createPlatformFixture,
  PLATFORM_FIXTURE_DRIVERS,
  type PlatformFixture,
  type PlatformFixtureProject,
} from './support/platform-fixture'

const live = process.env.NUVIX_LIVE_POSTGRES === '1' ? describe : describe.skip
const TARGET_CONNECTION = 'postgresql://nuvix_admin:fixture-target-secret@127.0.0.1:65535/postgres'
const PROJECT = Object.freeze({
  id: 'platform_fixture_project',
  enabled: true,
  target: Object.freeze({
    driver: 'postgresql' as const,
    connectionString: TARGET_CONNECTION,
  }),
}) satisfies PlatformFixtureProject
const PROJECTS = Object.freeze([PROJECT])

function sqliteFilename(label: string): string {
  const identifier = crypto.randomUUID().replaceAll('-', '').toLowerCase()
  return `/tmp/opencode/nuvix-platform-${label}-${process.pid}-${identifier}.sqlite`
}

async function close(
  platform: PlatformDatabaseOwner | undefined,
  fixture: PlatformFixture,
): Promise<void> {
  const failures: unknown[] = []
  if (platform) await platform.close().catch((error: unknown) => failures.push(error))
  await fixture.owner.close().catch((error: unknown) => failures.push(error))
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Platform provisioning test cleanup failed')
  }
}

describe('platform provisioning fixture', () => {
  test('rejects SQLite in-memory configuration', async () => {
    await expect(
      createPlatformFixture({
        driver: 'sqlite',
        projects: PROJECTS,
        sqliteFilename: ':memory:',
      }),
    ).rejects.toThrow('requires a unique real file')
  })

  test('removes a real SQLite file after partial provisioning failure', async () => {
    const filename = sqliteFilename('partial')
    const duplicateProjects = Object.freeze([PROJECT, PROJECT])

    await expect(
      createPlatformFixture({
        driver: 'sqlite',
        projects: duplicateProjects,
        sqliteFilename: filename,
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(await Bun.file(filename).exists()).toBe(false)
    expect(await Bun.file(`${filename}-journal`).exists()).toBe(false)
    expect(await Bun.file(`${filename}-wal`).exists()).toBe(false)
    expect(await Bun.file(`${filename}-shm`).exists()).toBe(false)
  })

  test('owns a unique real SQLite file through teardown', async () => {
    const first = await createPlatformFixture({
      driver: 'sqlite',
      projects: PROJECTS,
    })
    let second: PlatformFixture | undefined
    let firstFilename: string | undefined
    let secondFilename: string | undefined

    try {
      const firstDatabase = first.runtime.database
      if (firstDatabase.driver !== 'sqlite') throw new Error('Expected SQLite fixture')
      firstFilename = firstDatabase.filename
      second = await createPlatformFixture({
        driver: 'sqlite',
        projects: PROJECTS,
      })
      const secondDatabase = second.runtime.database
      if (secondDatabase.driver !== 'sqlite') throw new Error('Expected SQLite fixture')
      secondFilename = secondDatabase.filename

      expect(firstFilename).not.toBe(':memory:')
      expect(secondFilename).not.toBe(firstFilename)
      expect(await Bun.file(firstFilename).exists()).toBe(true)
      expect(await Bun.file(secondFilename).exists()).toBe(true)
    } finally {
      await Promise.allSettled([...(second ? [second.owner.close()] : []), first.owner.close()])
    }

    expect(await Bun.file(firstFilename!).exists()).toBe(false)
    expect(await Bun.file(secondFilename!).exists()).toBe(false)
  })
})

for (const driver of PLATFORM_FIXTURE_DRIVERS) {
  live(`platform provisioning through ${driver}`, () => {
    test('persists encrypted targets and reopens them through the normal resolver', async () => {
      const fixture = await createPlatformFixture({
        driver,
        projects: PROJECTS,
      })
      let platform: PlatformDatabaseOwner | undefined

      try {
        const ciphertext = await fixture.owner.inspectTargetCiphertext(PROJECT.id)

        expect(ciphertext).toMatch(/^ntt1\.[a-zA-Z0-9_-]+$/)
        expect(ciphertext).not.toContain(PROJECT.target.connectionString)
        expect(Object.keys(fixture.runtime).sort()).toEqual(['database', 'tenantTargetFilters'])

        platform = await createPlatformDatabase(fixture.runtime.database, {
          tenantTargetFilters: fixture.runtime.tenantTargetFilters,
        })
        const resolvedProject = await createPlatformProjectLookup(platform.lookups).resolve(
          PROJECT.id,
        )
        const resolvedTarget = await createTenantTargetResolver(platform.lookups).resolve(
          PROJECT.id,
        )

        expect(resolvedProject).toEqual({ id: PROJECT.id, enabled: true })
        expect(resolvedTarget).toEqual(PROJECT.target)
      } finally {
        await close(platform, fixture)
      }
    })
  })
}

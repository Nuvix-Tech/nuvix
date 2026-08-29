import { describe, expect, test } from 'bun:test'

import {
  type MigrationCliDependencies,
  type MigrationEnvironment,
  type MigrationResource,
  runMigrationCli,
} from '../scripts/migrate'
import type { MigrationDatabase } from '../src/migrate'

const DATABASE_URL =
  'postgresql://migration-user:migration-secret@sentinel.internal:6543/platform?sslmode=require'
const SECRET_ERROR = new Error(
  `${DATABASE_URL} api-key=key-sentinel ciphertext=ciphertext-sentinel`,
)

interface FakeCli {
  readonly dependencies: MigrationCliDependencies
  readonly database: MigrationDatabase
  readonly events: string[]
  readonly stdout: string[]
  readonly stderr: string[]
}

function fakeCli(
  options: {
    readonly create?: () => MigrationResource
    readonly migrate?: () => Promise<readonly string[]>
    readonly close?: () => Promise<void>
    readonly stdout?: (message: string) => Promise<void>
    readonly stderr?: (message: string) => Promise<void>
  } = {},
): FakeCli {
  const events: string[] = []
  const stdout: string[] = []
  const stderr: string[] = []
  const database: MigrationDatabase = {
    transaction: async <TResult>() => [] as TResult,
  }
  const defaultResource: MigrationResource = {
    database,
    close: async () => {
      events.push('close')
      await options.close?.()
    },
  }

  return {
    database,
    events,
    stdout,
    stderr,
    dependencies: {
      create: (url) => {
        events.push('create')
        expect(url).toBe(DATABASE_URL)
        return options.create?.() ?? defaultResource
      },
      migrate: async (received) => {
        events.push('migrate')
        expect(received).toBe(database)
        return options.migrate?.() ?? []
      },
      stdout: async (message) => {
        stdout.push(message)
        await options.stdout?.(message)
      },
      stderr: async (message) => {
        stderr.push(message)
        await options.stderr?.(message)
      },
    },
  }
}

const validEnvironment: MigrationEnvironment = {
  NUVIX_INTERNAL_DATABASE_URL: DATABASE_URL,
}

describe('runMigrationCli', () => {
  test('rejects arguments before creating migration resources', async () => {
    const fake = fakeCli()

    const status = await runMigrationCli(['unexpected'], validEnvironment, fake.dependencies)

    expect(status).toBe(1)
    expect(fake.events).toEqual([])
    expect(fake.stdout).toEqual([])
    expect(fake.stderr).toEqual(['Usage: bun run migrate:platform'])
  })

  for (const environment of [
    {},
    { NUVIX_INTERNAL_DATABASE_URL: '' },
    { NUVIX_INTERNAL_DATABASE_URL: '   ' },
    { NUVIX_INTERNAL_DATABASE_URL: `${DATABASE_URL} ` },
  ] satisfies readonly MigrationEnvironment[]) {
    test('rejects missing or malformed migration-only environment input', async () => {
      const fake = fakeCli()

      const status = await runMigrationCli([], environment, fake.dependencies)

      expect(status).toBe(1)
      expect(fake.events).toEqual([])
      expect(fake.stdout).toEqual([])
      expect(fake.stderr).toEqual(['Platform migration configuration is invalid'])
    })
  }

  test('requires only the migration database URL and reports fixed success output', async () => {
    const fake = fakeCli()

    const status = await runMigrationCli([], validEnvironment, fake.dependencies)

    expect(status).toBe(0)
    expect(fake.events).toEqual(['create', 'migrate', 'close'])
    expect(fake.stdout).toEqual(['Platform migrations completed'])
    expect(fake.stderr).toEqual([])
  })

  test('awaits close before reporting migration success', async () => {
    let finishClose = (): void => undefined
    let markCloseStarted = (): void => undefined
    let settled = false
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve
    })
    const fake = fakeCli({
      close: () =>
        new Promise<void>((resolve) => {
          markCloseStarted()
          finishClose = resolve
        }),
    })

    const pending = runMigrationCli([], validEnvironment, fake.dependencies).then((status) => {
      settled = true
      return status
    })
    await closeStarted

    expect(settled).toBe(false)
    expect(fake.stdout).toEqual([])
    finishClose()
    expect(await pending).toBe(0)
    expect(fake.stdout).toEqual(['Platform migrations completed'])
  })

  test('awaits close after migration failure and returns a nonzero status', async () => {
    let finishClose = (): void => undefined
    let markCloseStarted = (): void => undefined
    let settled = false
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve
    })
    const fake = fakeCli({
      migrate: () => Promise.reject(SECRET_ERROR),
      close: () =>
        new Promise<void>((resolve) => {
          markCloseStarted()
          finishClose = resolve
        }),
    })

    const pending = runMigrationCli([], validEnvironment, fake.dependencies).then((status) => {
      settled = true
      return status
    })
    await closeStarted

    expect(settled).toBe(false)
    expect(fake.stderr).toEqual([])
    finishClose()
    expect(await pending).toBe(1)
    expect(fake.events).toEqual(['create', 'migrate', 'close'])
    expect(fake.stderr).toEqual(['Platform migration failed'])
  })

  test('returns a nonzero status when close fails', async () => {
    const fake = fakeCli({ close: () => Promise.reject(SECRET_ERROR) })

    const status = await runMigrationCli([], validEnvironment, fake.dependencies)

    expect(status).toBe(1)
    expect(fake.events).toEqual(['create', 'migrate', 'close'])
    expect(fake.stdout).toEqual([])
    expect(fake.stderr).toEqual(['Platform migration failed'])
  })

  test('awaits success output before returning', async () => {
    let finishOutput = (): void => undefined
    let markOutputStarted = (): void => undefined
    let settled = false
    const outputStarted = new Promise<void>((resolve) => {
      markOutputStarted = resolve
    })
    const fake = fakeCli({
      stdout: () =>
        new Promise<void>((resolve) => {
          markOutputStarted()
          finishOutput = resolve
        }),
    })

    const pending = runMigrationCli([], validEnvironment, fake.dependencies).then((status) => {
      settled = true
      return status
    })
    await outputStarted

    expect(settled).toBe(false)
    finishOutput()
    expect(await pending).toBe(0)
  })

  test('returns nonzero with fixed output when success output fails', async () => {
    const fake = fakeCli({ stdout: () => Promise.reject(SECRET_ERROR) })

    const status = await runMigrationCli([], validEnvironment, fake.dependencies)

    expect(status).toBe(1)
    expect(fake.stdout).toEqual(['Platform migrations completed'])
    expect(fake.stderr).toEqual(['Platform migration failed'])
    expectRedacted([...fake.stdout, ...fake.stderr].join('\n'))
  })

  test('preserves nonzero status when failure output also fails', async () => {
    const fake = fakeCli({ stderr: () => Promise.reject(SECRET_ERROR) })

    const status = await runMigrationCli(['unexpected'], validEnvironment, fake.dependencies)

    expect(status).toBe(1)
    expect(fake.stderr).toEqual(['Usage: bun run migrate:platform'])
  })

  test('redacts creation failures and reruns deterministically', async () => {
    const fake = fakeCli({
      create: () => {
        throw SECRET_ERROR
      },
    })

    const statuses = await Promise.all([
      runMigrationCli([], validEnvironment, fake.dependencies),
      runMigrationCli([], validEnvironment, fake.dependencies),
    ])

    expect(statuses).toEqual([1, 1])
    expect(fake.events).toEqual(['create', 'create'])
    expect(fake.stdout).toEqual([])
    expect(fake.stderr).toEqual(['Platform migration failed', 'Platform migration failed'])
    expectRedacted([...fake.stdout, ...fake.stderr].join('\n'))
  })
})

test('package exposes only an explicit migration script and startup paths do not invoke it', async () => {
  const platformPackage = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
    readonly scripts: Readonly<Record<string, string>>
  }
  const rootPackage = (await Bun.file(
    new URL('../../../package.json', import.meta.url),
  ).json()) as {
    readonly scripts: Readonly<Record<string, string>>
  }
  const serverPackage = (await Bun.file(
    new URL('../../../apps/server/package.json', import.meta.url),
  ).json()) as {
    readonly scripts: Readonly<Record<string, string>>
  }
  const startupScripts = [
    rootPackage.scripts.dev,
    rootPackage.scripts.start ?? '',
    serverPackage.scripts.dev,
    serverPackage.scripts.start,
  ]

  expect(platformPackage.scripts['migrate:platform']).toBe('bun run scripts/migrate.ts')
  expect(startupScripts.join('\n')).not.toMatch(/migrat(?:e|ion)/i)
})

function expectRedacted(output: string): void {
  for (const secret of [
    DATABASE_URL,
    'postgresql://',
    'migration-user',
    'migration-secret',
    'sentinel.internal',
    '6543',
    'platform',
    'sslmode=require',
    'api-key',
    'key-sentinel',
    'ciphertext-sentinel',
  ]) {
    expect(output).not.toContain(secret)
  }
}

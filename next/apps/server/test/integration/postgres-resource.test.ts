import { describe, expect, test } from 'bun:test'
import { type PostgresResourceProcesses, startPostgresResource } from './support/postgres-resource'

interface RecordedCommand {
  readonly arguments: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
}

function fakeProcesses(options: { readonly ready?: boolean } = {}) {
  const commands: RecordedCommand[] = []
  const events: string[] = []
  const ports = new Map<string, number>()
  const identifiers = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ]
  let nextIdentifier = 0
  let nextPort = 41_000

  const processes: PostgresResourceProcesses = {
    command: async (arguments_, environment) => {
      commands.push({ arguments: [...arguments_], environment })
      const operation = arguments_[1]
      if (operation === 'run') {
        const name = arguments_[arguments_.indexOf('--name') + 1]!
        ports.set(name, nextPort)
        nextPort += 1
        return { exitCode: 0, stdout: 'container-id\n' }
      }
      if (operation === 'port') {
        return {
          exitCode: 0,
          stdout: `127.0.0.1:${ports.get(arguments_[2]!)!}\n`,
        }
      }
      if (operation === 'exec') {
        return { exitCode: options.ready === false ? 1 : 0, stdout: '' }
      }
      return { exitCode: 0, stdout: '' }
    },
    randomUUID: () => identifiers[nextIdentifier++]!,
    registerSignals: () => {
      events.push('signals')
      return () => events.push('unregister')
    },
    sleep: async () => {},
  }

  return { commands, events, processes }
}

describe('PostgreSQL integration resource', () => {
  test('uses only the exact image and keeps credentials out of command arguments', async () => {
    const fake = fakeProcesses()
    const resource = await startPostgresResource({}, fake.processes)

    const image = fake.commands.find(({ arguments: command }) => command[1] === 'image')!
    const run = fake.commands.find(({ arguments: command }) => command[1] === 'run')!
    const password = run.environment?.POSTGRES_PASSWORD

    expect(image.arguments.at(-1)).toBe('nuvix/postgres:18.1')
    expect(run.arguments.at(-1)).toBe('nuvix/postgres:18.1')
    expect(run.arguments).toContain('--pull=never')
    expect(run.arguments).toContain('127.0.0.1::5432')
    expect(run.arguments).not.toContain(password)
    expect(fake.events[0]).toBe('signals')
    expect(Object.keys(resource.owner)).toEqual(['connectionString'])
    expect(JSON.stringify(resource)).not.toContain(password!)
    const owner = new URL(resource.owner.connectionString())
    expect({
      protocol: owner.protocol,
      hostname: owner.hostname,
      port: owner.port,
      username: owner.username,
      database: owner.pathname,
    }).toEqual({
      protocol: 'postgresql:',
      hostname: '127.0.0.1',
      port: '41000',
      username: 'nuvix_admin',
      database: '/postgres',
    })

    await resource.close()
  })

  test('removes a partially started container when readiness never succeeds', async () => {
    const fake = fakeProcesses({ ready: false })

    const failure = await startPostgresResource(
      { readinessAttempts: 3, readinessIntervalMs: 1 },
      fake.processes,
    ).catch((error: unknown) => error)
    const removals = fake.commands.filter(({ arguments: command }) => command[1] === 'rm')

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('PostgreSQL test resource readiness failed')
    expect(removals).toHaveLength(1)
    expect(fake.events).toEqual(['signals', 'unregister'])
  })

  test('isolates concurrent resources with unique names and daemon-assigned ports', async () => {
    const fake = fakeProcesses()

    const [first, second] = await Promise.all([
      startPostgresResource({}, fake.processes),
      startPostgresResource({}, fake.processes),
    ])
    const runs = fake.commands.filter(({ arguments: command }) => command[1] === 'run')
    const names = runs.map(({ arguments: command }) => command[command.indexOf('--name') + 1])

    expect(new Set(names).size).toBe(2)
    const firstConnection = new URL(first.owner.connectionString())
    const secondConnection = new URL(second.owner.connectionString())
    expect(firstConnection.port).not.toBe(secondConnection.port)

    await Promise.all([first.close(), second.close()])
  })

  test('shares repeated close calls and removes the container once', async () => {
    const fake = fakeProcesses()
    const resource = await startPostgresResource({}, fake.processes)

    const first = resource.close()

    expect(resource.close()).toBe(first)
    await first
    expect(fake.commands.filter(({ arguments: command }) => command[1] === 'rm')).toHaveLength(1)
  })
})

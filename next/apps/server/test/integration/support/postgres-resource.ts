const POSTGRES_IMAGE = 'nuvix/postgres:18.1'
const POSTGRES_HOST = '127.0.0.1'
const POSTGRES_PORT = 5432
const POSTGRES_USER = 'nuvix_admin'
const POSTGRES_INSPECTION_USER = 'postgres'
const POSTGRES_DATABASE = 'postgres'

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
}

export interface PostgresResourceProcesses {
  readonly command: (
    arguments_: readonly string[],
    environment?: Readonly<Record<string, string>>,
  ) => Promise<CommandResult>
  readonly randomUUID: () => string
  readonly registerSignals: (cleanup: () => Promise<void>) => () => void
  readonly sleep: (milliseconds: number) => Promise<void>
}

export interface PostgresResourceOptions {
  readonly readinessAttempts?: number
  readonly readinessIntervalMs?: number
}

export interface PostgresOwnerConnection {
  connectionString(): string
  assertNoClientConnections(): Promise<void>
  assertRemoved(): Promise<void>
}

export interface PostgresTestResource {
  readonly owner: PostgresOwnerConnection
  close(): Promise<void>
}

class PostgresResourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostgresResourceError'
  }
}

async function command(
  arguments_: readonly string[],
  environment?: Readonly<Record<string, string>>,
): Promise<CommandResult> {
  const subprocess = Bun.spawn([...arguments_], {
    env: environment ? { ...process.env, ...environment } : process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  })
  const [stdout, , exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  return { exitCode, stdout }
}

const signalCleanups = new Set<() => Promise<void>>()
let listeningForSignals = false

function stopListeningForSignals(): void {
  if (!listeningForSignals) return
  listeningForSignals = false
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', terminate)
}

function forwardSignal(signal: 'SIGINT' | 'SIGTERM'): void {
  // Forward only after every live resource has had one cleanup opportunity.
  const cleanups = [...signalCleanups]
  signalCleanups.clear()
  stopListeningForSignals()
  void Promise.allSettled(cleanups.map((cleanup) => cleanup())).finally(() =>
    process.kill(process.pid, signal),
  )
}

function interrupt(): void {
  forwardSignal('SIGINT')
}

function terminate(): void {
  forwardSignal('SIGTERM')
}

function registerSignals(cleanup: () => Promise<void>): () => void {
  signalCleanups.add(cleanup)
  if (!listeningForSignals) {
    listeningForSignals = true
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', terminate)
  }
  return () => {
    signalCleanups.delete(cleanup)
    if (signalCleanups.size === 0) stopListeningForSignals()
  }
}

const DEFAULT_PROCESSES: PostgresResourceProcesses = {
  command,
  randomUUID: () => crypto.randomUUID(),
  registerSignals,
  sleep: (milliseconds) => Bun.sleep(milliseconds),
}

async function requireSuccess(
  processes: PostgresResourceProcesses,
  arguments_: readonly string[],
  operation: string,
  environment?: Readonly<Record<string, string>>,
): Promise<CommandResult> {
  const result = await processes.command(arguments_, environment).catch(() => undefined)
  if (result?.exitCode !== 0) {
    throw new PostgresResourceError(`PostgreSQL test resource ${operation} failed`)
  }
  return result
}

function port(output: string): number {
  const match = /:(\d+)\s*$/.exec(output)
  const selected = Number(match?.[1])
  if (!Number.isInteger(selected) || selected < 1 || selected > 65_535) {
    throw new PostgresResourceError('PostgreSQL test resource port discovery failed')
  }
  return selected
}

async function waitUntilReady(
  processes: PostgresResourceProcesses,
  containerName: string,
  attempts: number,
  intervalMs: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await processes
      .command([
        'docker',
        'exec',
        containerName,
        'pg_isready',
        '--host',
        POSTGRES_HOST,
        '--port',
        String(POSTGRES_PORT),
        '--username',
        POSTGRES_USER,
        '--dbname',
        POSTGRES_DATABASE,
        '--quiet',
      ])
      .catch(() => undefined)
    if (result?.exitCode === 0) return
    if (attempt < attempts) await processes.sleep(intervalMs)
  }
  throw new PostgresResourceError('PostgreSQL test resource readiness failed')
}

async function assertNoClientConnections(
  processes: PostgresResourceProcesses,
  containerName: string,
  attempts = 10,
  intervalMs = 100,
): Promise<void> {
  // Inspect over the container-local socket so generated credentials never
  // enter process arguments; exclude the inspection session itself.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await requireSuccess(
      processes,
      [
        'docker',
        'exec',
        containerName,
        'psql',
        '--username',
        POSTGRES_INSPECTION_USER,
        '--dbname',
        POSTGRES_DATABASE,
        '--tuples-only',
        '--no-align',
        '--command',
        'select count(*) from pg_stat_activity where datname = current_database() and client_addr is not null',
      ],
      'connection inspection',
    )
    if (result.stdout.trim() === '0') return
    if (attempt < attempts) await processes.sleep(intervalMs)
  }
  throw new PostgresResourceError('PostgreSQL test resource retained client connections')
}

async function assertRemoved(
  processes: PostgresResourceProcesses,
  containerName: string,
): Promise<void> {
  const result = await requireSuccess(
    processes,
    ['docker', 'ps', '--all', '--quiet', '--filter', `name=^/${containerName}$`],
    'cleanup verification',
  )
  if (result.stdout.trim() !== '') {
    throw new PostgresResourceError('PostgreSQL test resource cleanup verification failed')
  }
}

function owner(
  port: number,
  password: string,
  processes: PostgresResourceProcesses,
  containerName: string,
): PostgresOwnerConnection {
  return Object.freeze({
    connectionString: () => {
      const connection = new URL(`postgresql://${POSTGRES_HOST}:${port}/${POSTGRES_DATABASE}`)
      connection.username = POSTGRES_USER
      connection.password = password
      return connection.toString()
    },
    assertNoClientConnections: () => assertNoClientConnections(processes, containerName),
    assertRemoved: () => assertRemoved(processes, containerName),
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new TypeError(`${name} must be a positive integer`)
  return value
}

export async function startPostgresResource(
  options: PostgresResourceOptions = {},
  processes: PostgresResourceProcesses = DEFAULT_PROCESSES,
): Promise<PostgresTestResource> {
  const attempts = positiveInteger(options.readinessAttempts ?? 120, 'readinessAttempts')
  const intervalMs = positiveInteger(options.readinessIntervalMs ?? 500, 'readinessIntervalMs')
  const uniqueName = processes.randomUUID().replaceAll('-', '').toLowerCase()
  const containerName = `nuvix-pg-it-${process.pid}-${uniqueName}`
  const password = `nuvix_test_${processes.randomUUID().replaceAll('-', '')}`
  let closePromise: Promise<void> | undefined
  let unregisterSignals = () => {}
  const close = () => {
    closePromise ??= requireSuccess(
      processes,
      ['docker', 'rm', '--force', '--volumes', containerName],
      'cleanup',
    )
      .then(() => undefined)
      .finally(() => unregisterSignals())
    return closePromise
  }

  unregisterSignals = processes.registerSignals(close)

  try {
    await requireSuccess(
      processes,
      ['docker', 'image', 'inspect', '--format={{.Id}}', POSTGRES_IMAGE],
      'image check',
    )
    await requireSuccess(
      processes,
      [
        'docker',
        'run',
        '--detach',
        '--name',
        containerName,
        '--publish',
        `${POSTGRES_HOST}::${POSTGRES_PORT}`,
        '--env',
        'POSTGRES_PASSWORD',
        '--pull=never',
        POSTGRES_IMAGE,
      ],
      'startup',
      { POSTGRES_PASSWORD: password },
    )
    const mapping = await requireSuccess(
      processes,
      ['docker', 'port', containerName, `${POSTGRES_PORT}/tcp`],
      'port discovery',
    )
    const ownerPort = port(mapping.stdout)
    await waitUntilReady(processes, containerName, attempts, intervalMs)

    return Object.freeze({
      owner: owner(ownerPort, password, processes, containerName),
      close,
    })
  } catch (error) {
    await close().catch(() => undefined)
    if (error instanceof PostgresResourceError) throw error
    throw new PostgresResourceError('PostgreSQL test resource startup failed')
  }
}

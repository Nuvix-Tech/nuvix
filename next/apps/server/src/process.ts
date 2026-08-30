import type { NuvixApp } from './app'

interface HttpServer {
  readonly hostname: string
  readonly port: number
  stop(closeActiveConnections?: boolean): Promise<void>
}

export interface ProcessRuntime {
  readonly app: NuvixApp
  close(): Promise<void>
}

export interface ProcessOptions {
  readonly host: string
  readonly port: number
}

export interface ProcessOwner {
  readonly server: HttpServer
  close(): Promise<void>
}

type Serve = (options: { hostname: string; port: number; fetch: NuvixApp['fetch'] }) => HttpServer

async function closeInOrder(server: HttpServer, runtime: ProcessRuntime): Promise<void> {
  const failures: Error[] = []
  await Promise.resolve()
    .then(() => server.stop())
    .catch(() => failures.push(new Error('HTTP server stop failed')))
  await Promise.resolve()
    .then(() => runtime.close())
    .catch(() => failures.push(new Error('Runtime resource close failed')))
  if (failures.length > 0) throw new AggregateError(failures, 'Server process close failed')
}

/** Starts HTTP and owns deterministic stop-then-resource shutdown. */
export async function startProcess(
  runtime: ProcessRuntime,
  options: ProcessOptions,
  serve: Serve = (input) => Bun.serve(input) as unknown as HttpServer,
): Promise<ProcessOwner> {
  let server: HttpServer
  try {
    server = serve({
      hostname: options.host,
      port: options.port,
      fetch: runtime.app.fetch,
    })
  } catch (error) {
    await Promise.resolve()
      .then(() => runtime.close())
      .catch(() => undefined)
    throw error
  }
  let closePromise: Promise<void> | undefined

  return Object.freeze({
    server,
    close: () => {
      closePromise ??= closeInOrder(server, runtime)
      return closePromise
    },
  })
}

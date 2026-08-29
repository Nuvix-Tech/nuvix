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

/** Starts HTTP and owns deterministic stop-then-resource shutdown. */
export function startProcess(
  runtime: ProcessRuntime,
  options: ProcessOptions,
  serve: Serve = (input) => Bun.serve(input) as unknown as HttpServer,
): ProcessOwner {
  const server = serve({
    hostname: options.host,
    port: options.port,
    fetch: runtime.app.fetch,
  })
  let closePromise: Promise<void> | undefined

  return Object.freeze({
    server,
    close: () => {
      closePromise ??= (async () => {
        const failures: unknown[] = []
        await server.stop().catch((error: unknown) => failures.push(error))
        await runtime.close().catch((error: unknown) => failures.push(error))
        if (failures.length > 0) throw new AggregateError(failures, 'Server process close failed')
      })()
      return closePromise
    },
  })
}

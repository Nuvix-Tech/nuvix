import { config } from '@nuvix/utils'
import { createPlatformRuntime } from './infrastructure/platform-runtime'
import { startProcess } from './process'

const runtime = await createPlatformRuntime({
  database: config.internalDatabase,
  publishableKeyEnvironment: config.isProd ? 'live' : 'test',
  app: { isProduction: config.isProd },
  onTenantCloseError: () => {
    console.error('[nuvix] tenant database close failed')
  },
})
const processOwner = startProcess(runtime, {
  host: config.host,
  port: config.port,
})

let shutdownStarted = false
const shutdown = async () => {
  if (shutdownStarted) return
  shutdownStarted = true
  await processOwner.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

console.log(
  `[nuvix] v2 API listening on http://${processOwner.server.hostname}:${processOwner.server.port} (${config.env})`,
)

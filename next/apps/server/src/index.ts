import { config } from '@nuvix/utils'
import { createPlatformRuntime } from './infrastructure/platform-runtime'
import { createTenantTargetFilters } from './infrastructure/tenant-target-codec'
import { startProcess } from './process'

const tenantTargetFilters = await createTenantTargetFilters(
  config.security.tenantTargetEncryptionKey,
)
const runtime = await createPlatformRuntime({
  database: config.internalDatabase,
  tenantTargetFilters,
  publishableKeyEnvironment: config.isProd ? 'live' : 'test',
  app: { isProduction: config.isProd },
  onTenantCloseError: (_error, projectId) => {
    console.error('[nuvix] tenant database close failed', { projectId })
  },
})
const processOwner = await startProcess(runtime, {
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

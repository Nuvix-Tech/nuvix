import { config } from '@nuvix/utils'
import { app } from './app'

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
})

console.log(`[nuvix] v2 API listening on http://${server.hostname}:${server.port} (${config.env})`)

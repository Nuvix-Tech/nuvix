import { openapi } from '@elysia/openapi'
import { TranslationLoader } from '@nuvix/i18n'
import { Elysia, t } from 'elysia'
import { accountRoutes } from './account/route'
import { avatarRoutes } from './avatars/route'
import { type AvatarService, createAvatarService } from './avatars/service'
import { createGeoIP, type GeoIP } from './context/geoip'
import { getTranslator, localeContext } from './context/locale'
import { schemaRoutes } from './database/route'
import type { DatabaseRequestCapabilities } from './infrastructure/database-composition'
import { localeRoutes } from './locale/route'
import { createMessagingGateway, type MessagingGateway } from './messaging/gateway'
import { messagingRoutes } from './messaging/route'
import { type PlatformRouteDependencies, platformRoute } from './platform/route'
import { cors } from './plugins/cors'
import { problemErrors } from './plugins/errors'
import { rateLimit } from './plugins/rate-limit'
import { securityHeaders } from './plugins/security'
import { ServiceUnavailableError } from './shared/errors'
import { storageRoutes } from './storage/route'
import { teamRoutes } from './teams/route'
import { userRoutes } from './users/route'
import { createWebhookDispatcher, type WebhookDispatcher } from './webhooks/dispatcher'
import { webhookRoutes } from './webhooks/route'

const DEFAULT_TRANSLATIONS = new URL('../../../assets/locale/translations', import.meta.url)
  .pathname

export interface AppOptions {
  readonly isProduction?: boolean
  readonly translationsDir?: string
  readonly geoip?: GeoIP
  readonly avatars?: AvatarService
  readonly uptime?: () => number
  readonly projectRequests?: DatabaseRequestCapabilities
  readonly messagingGateway?: MessagingGateway
  readonly webhookDispatcher?: WebhookDispatcher
  readonly platform?: PlatformRouteDependencies
}

const UNAVAILABLE_PROJECT_REQUESTS: DatabaseRequestCapabilities = {
  withProject: async () => {
    throw new ServiceUnavailableError('Project services are unavailable', {
      code: 'project_unavailable',
    })
  },
}

/** Creates framework routing; the live process injects its database composition owner. */
export async function createApp(options: AppOptions = {}) {
  const loader = new TranslationLoader(options.translationsDir ?? DEFAULT_TRANSLATIONS)
  const localeOptions = {
    loader,
    available: await loader.availableLocales(),
  } as const
  const geoip = options.geoip ?? (await createGeoIP())
  const avatars = options.avatars ?? createAvatarService()
  const uptime = options.uptime ?? (() => process.uptime())
  const messagingGateway = options.messagingGateway ?? createMessagingGateway()
  const webhookDispatcher = options.webhookDispatcher ?? createWebhookDispatcher()

  const health = new Elysia({ name: 'health' }).get(
    '/health',
    {
      response: t.Object({
        status: t.Literal('ok'),
        version: t.String(),
        uptime: t.Number(),
      }),
    },
    () => ({ status: 'ok', version: '2.0.0-alpha.1', uptime: uptime() }),
  )

  const app = new Elysia({ prefix: '/v2' })
    .use(
      cors({
        origin: options.isProduction ? [] : true,
        allowedHeaders: [
          'content-type',
          'authorization',
          'x-nuvix-publishable-key',
          'x-nuvix-session',
          'x-nuvix-jwt',
          'x-nuvix-key',
          'x-nuvix-mode',
          'x-nuvix-locale',
        ],
      }),
    )
    .use(securityHeaders)
    .use(rateLimit({ max: 300, windowMs: 60_000 }))
    .use(
      problemErrors({
        getTranslator: (headers) => getTranslator(headers, localeOptions),
      }),
    )
    .use(
      openapi({
        documentation: { info: { title: 'Nuvix API', version: '2.0.0' } },
      }),
    )
    .use(localeContext(localeOptions))
    .use(localeRoutes(geoip, localeOptions))
    .use(avatarRoutes(avatars))
    .use(schemaRoutes(options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS))
    .use(teamRoutes(options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS))
    .use(userRoutes(options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS))
    .use(accountRoutes(options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS))
    .use(storageRoutes(options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS))
    .use(
      messagingRoutes({
        requests: options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS,
        gateway: messagingGateway,
      }),
    )
    .use(
      webhookRoutes({
        requests: options.projectRequests ?? UNAVAILABLE_PROJECT_REQUESTS,
        dispatcher: webhookDispatcher,
      }),
    )
    .use(health)

  if (options.platform) {
    app.use(platformRoute(options.platform))
  }

  return app
}

export type NuvixApp = Awaited<ReturnType<typeof createApp>>

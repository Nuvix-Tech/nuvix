import { openapi } from '@elysia/openapi'
import { TranslationLoader } from '@nuvix/i18n'
import { Elysia, t } from 'elysia'
import { avatarRoutes } from './avatars/route'
import { type AvatarService, createAvatarService } from './avatars/service'
import { createGeoIP, type GeoIP } from './context/geoip'
import { getTranslator, localeContext } from './context/locale'
import { localeRoutes } from './locale/route'
import { cors } from './plugins/cors'
import { problemErrors } from './plugins/errors'
import { rateLimit } from './plugins/rate-limit'
import { securityHeaders } from './plugins/security'

const DEFAULT_TRANSLATIONS = new URL('../../../assets/locale/translations', import.meta.url)
  .pathname

export interface AppOptions {
  readonly isProduction?: boolean
  readonly translationsDir?: string
  readonly geoip?: GeoIP
  readonly avatars?: AvatarService
  readonly uptime?: () => number
}

/** Creates framework routing only; process-owned database resources are injected by later slices. */
export async function createApp(options: AppOptions = {}) {
  const loader = new TranslationLoader(options.translationsDir ?? DEFAULT_TRANSLATIONS)
  const localeOptions = {
    loader,
    available: await loader.availableLocales(),
  } as const
  const geoip = options.geoip ?? (await createGeoIP())
  const avatars = options.avatars ?? createAvatarService()
  const uptime = options.uptime ?? (() => process.uptime())

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

  return new Elysia({ prefix: '/v2' })
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
    .use(health)
}

export type NuvixApp = Awaited<ReturnType<typeof createApp>>

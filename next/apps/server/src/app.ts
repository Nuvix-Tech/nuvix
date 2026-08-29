import { openapi } from '@elysia/openapi'
import { TranslationLoader } from '@nuvix/i18n'
import { config } from '@nuvix/utils'
import { Elysia, t } from 'elysia'
import { avatarRoutes } from './avatars/route'
import { createAvatarService } from './avatars/service'
import { authContext } from './context/auth'
import { createGeoIP } from './context/geoip'
import { getTranslator, localeContext } from './context/locale'
import { localeRoutes } from './locale/route'
import { cors } from './plugins/cors'
import { problemErrors } from './plugins/errors'
import { rateLimit } from './plugins/rate-limit'
import { securityHeaders } from './plugins/security'

/**
 * Framework glue — the ONLY place Elysia-specific wiring lives.
 * Routes are composed as plugins and mounted here.
 */

// Translation assets live at the monorepo root (see docs/api/_i18n.md).
const translationsDir = new URL('../../../assets/locale/translations', import.meta.url).pathname
const i18nLoader = new TranslationLoader(translationsDir)
const localeOptions = {
  loader: i18nLoader,
  available: await i18nLoader.availableLocales(),
} as const

const health = new Elysia({ name: 'health' }).get(
  '/health',
  {
    response: t.Object({
      status: t.Literal('ok'),
      version: t.String(),
      uptime: t.Number(),
    }),
  },
  () => ({
    status: 'ok',
    version: '2.0.0-alpha.1',
    uptime: process.uptime(),
  }),
)

// Module services — constructed once at startup (graceful degradation built in).
const geoip = await createGeoIP()
const avatars = createAvatarService()

export const app = new Elysia({ prefix: '/v2' })
  .use(
    cors({
      origin: config.isProd ? [] : true,
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
  // Scalar UI at /v2/openapi, spec at /v2/openapi/json
  .use(
    openapi({
      documentation: { info: { title: 'Nuvix API', version: '2.0.0' } },
    }),
  )
  .use(authContext({ jwtSecret: config.jwtSecret }))
  .use(localeContext(localeOptions))
  .use(localeRoutes(geoip, localeOptions))
  .use(avatarRoutes(avatars))
  // Dev-only route exercising the context chain; removed once real modules land.
  // NOTE: defined inline AFTER authContext so the derived `auth` type flows in
  // ('plugin'-scoped derive types only reach routes registered downstream).
  .get('/whoami', ({ auth }) => ({ auth }))
  .use(health)

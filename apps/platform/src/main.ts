/**
 * Main entry point for the Nuvix Console API application.
 */
import { CoreService } from '@nuvix/core'

CoreService.setIsConsole(true)

import cookieParser from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import {
  ConsoleLogger,
  LOG_LEVELS,
  LogLevel,
  ValidationPipe,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule } from '@nestjs/swagger'
import {
  configureDbFiltersAndFormats,
  configureHandlebarsHelpers,
  configurePgTypeParsers,
} from '@nuvix/core'
import { ErrorFilter } from '@nuvix/core/filters'
import { RequestContext } from '@nuvix/core/helpers'
import { NuvixAdapter, NuvixFactory } from '@nuvix/core/server'
import { Authorization, Role, storage } from '@nuvix/db'
import {
  AppMode,
  configuration,
  PROJECT_ROOT,
  parseNumber,
  validateConfig,
} from '@nuvix/utils'
import QueryString from 'qs'
import { AppModule } from './app.module'
import { initSetup } from './utils/initial-setup'
import { openApiSetup } from './utils/open-api'

configurePgTypeParsers()
configureDbFiltersAndFormats()
validateConfig()
configureHandlebarsHelpers()
Authorization.enableAsyncLocalStorage()

export async function bootstrap() {
  const logLevels = configuration.app.isProduction
    ? (configuration.logLevels as LogLevel[])
    : undefined
  const logger = new ConsoleLogger({
    json: configuration.app.debug.json,
    colors: configuration.app.debug.colors,
    prefix: 'Nuvix-Console',
    logLevels,
  })

  const adapter = new NuvixAdapter({
    trustProxy: true,
    skipMiddie: true,
    routerOptions: {
      maxParamLength: 350,
      querystringParser(str) {
        return QueryString.parse(str)
      },
    },
    logger: {
      enabled: false,
      edgeLimit: 100,
      msgPrefix: '[Nuvix-Console] ',
      safe: true,
      level: 'error',
    },
  })

  const app = await NuvixFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      abortOnError: false,
      logger,
      autoFlushLogs: true,
    },
  )

  // @ts-expect-error
  app.register(cookieParser)
  // @ts-expect-error
  app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  })

  app.enableShutdownHooks()
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'X-API-Version',
    defaultVersion: VERSION_NEUTRAL,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      stopAtFirstError: false,
      transform: true,
      transformOptions: {
        exposeDefaultValues: true,
      },
      whitelist: true,
    }),
  )

  const fastify = adapter.getInstance()
  app.useStaticAssets({
    root: `${PROJECT_ROOT}/public`,
    prefix: '/public/',
  })

  fastify.addHook('onRequest', (req, __, done) => {
    storage.run(new Map(), () => {
      const request = req as unknown as NuvixRequest
      request.context = new RequestContext({
        mode: AppMode.DEFAULT,
      })
      Authorization.setDefaultStatus(true) // Set per-request default status
      Authorization.cleanRoles() // Reset roles per request
      Authorization.setRole(Role.any().toString())
      done()
    })
  })

  app.useGlobalFilters(new ErrorFilter())
  await initSetup(app)

  await SwaggerModule.loadPluginMetadata(async () => {
    try {
      // @ts-ignore
      return await (await import('./metadata')).default()
    } catch (err) {
      logger.warn('No swagger metadata found, skipping...')
      logger.debug((err as Error).stack || err)
      return {}
    }
  })
  openApiSetup(app)

  const port = parseNumber(process.env.NUVIX_CONSOLE_API_PORT, 4100)
  const host = '0.0.0.0'

  logger.setLogLevels(
    logLevels
      ? logLevels.filter(l => l !== 'log')
      : ['verbose', 'warn', 'error', 'fatal'],
  )
  await app.init()
  logger.setLogLevels(logLevels ?? LOG_LEVELS)

  await app.listen(port, host)

  logger.log(
    `🚀 Platform API application is running on: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    'Main',
  )
}
process.on('unhandledRejection', (reason: any) => {
  // PostgreSQL driver errors
  if (reason?.severity === 'ERROR' && reason?.code && reason?.routine) {
    return
  }

  console.error('[UnhandledRejection]', reason)
})

process.on('uncaughtException', (error: Error) => {
  console.error('[UncaughtException]', error)
})
bootstrap()

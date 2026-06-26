import * as crypto from 'node:crypto'
import cookieParser from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import { ValidationPipe } from '@nestjs/common'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import { ErrorFilter } from '@nuvix/core/filters'
import { RequestContext } from '@nuvix/core/helpers'
import { Authorization, Role, storage } from '@nuvix/db'
import { AppMode, configuration } from '@nuvix/utils'
import handlebars from 'handlebars'

/**
 * Applies common app configuration to the given NestFastifyApplication instance.
 */
export const applyAppConfig = (app: NestFastifyApplication): void => {
  app.enableShutdownHooks()
  app.enableVersioning()
  // @ts-expect-error
  app.register(cookieParser)
  // @ts-expect-error
  app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
    attachFieldsToBody: true,
  })

  app.setViewEngine({
    engine: {
      handlebars,
    },
    templates: configuration.assets.views,
    layout: 'layout.hbs',
  })

  app.useGlobalPipes(
    new ValidationPipe({
      stopAtFirstError: false,
      transform: true,
      transformOptions: {
        exposeDefaultValues: true,
      },
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )

  const fastify = app.getHttpAdapter().getInstance()
  fastify.setGenReqId(() => {
    return crypto.randomUUID() as string
  })

  const coreService = app.get(CoreService)
  const internaldb = coreService.getInternalDatabase()

  fastify.decorateRequest('hooks_args')
  fastify.addHook('onRequest', (_req, _, done) => {
    storage.run(new Map(), () => {
      // Keep deny-by-default from main.ts — don't override
      // Authorization.setDefaultStatus(true) // REMOVED: was overriding main.ts!
      Authorization.cleanRoles() // Reset roles per request
      // Don't set Role.any() — wait for auth.hook to set proper roles after authentication
      done()
    })
  })

  fastify.addHook('onRequest', async req => {
    const request = req as unknown as NuvixRequest
    request.context = new RequestContext()
    const project = await Authorization.skip(() =>
      internaldb.getDocument('projects', configuration.app.projectId),
    )

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND, 'Project not found', 404)
    }

    const mode =
      request.headers['x-nuvix-mode'] ||
      ((request.query as { mode?: string }).mode as string | undefined)

    if (mode && ![AppMode.ADMIN, AppMode.DEFAULT].includes(mode as AppMode)) {
      throw new Exception(Exception.INVALID_PARAMS, 'Invalid mode', 400)
    }

    request.context.project = project
    request.context.mode =
      mode === AppMode.ADMIN ? AppMode.ADMIN : AppMode.DEFAULT
  })

  fastify.addHook('onRequest', (request, _, done) => {
    const req = request as unknown as NuvixRequest
    let size = 0

    // Patch the raw stream push method
    const origPush = req.raw.push
    req.raw.push = function (chunk: any, encoding?: BufferEncoding) {
      if (chunk) {
        size += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk, encoding)
      }
      return origPush.call(this, chunk, encoding)
    }

    req.requestSize = () => size
    done()
  })

  app.useGlobalFilters(new ErrorFilter())
}

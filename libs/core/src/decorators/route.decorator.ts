import * as fs from 'node:fs'
import path from 'node:path'
import {
  All,
  applyDecorators,
  Delete,
  Get,
  Head,
  HttpCode,
  HttpStatus,
  Options,
  Patch,
  Post,
  Put,
  type Type,
} from '@nestjs/common'
import {
  ApiExcludeEndpoint,
  ApiExtension,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { configuration, type ThrottleOptions } from '@nuvix/utils'
import type { Scopes } from '../config'
import { Models } from '../helpers'
import type { ResolverTypeContextOptions } from '../resolvers'
import {
  type _AuditEvent,
  AuditEvent,
  type AuditEventKey,
} from './events.decorator'
import { Auth, type AuthType, Sensitive } from './misc.decorator'
import { ResModel } from './res-model.decorator'
import { Scope } from './scope.decorator'
import { Throttle } from './throttle.decorator'

type RouteMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'ALL'

interface ApiResponseConfig {
  status: HttpStatus | number
  description?: string
  type?: Type<any>
  /**
   * Content-Type(s) for this response
   * Example: ['application/json'], ['application/pdf'], ['image/png']
   */
  contentTypes?: string[]
}

/**
 * Configuration options for SDK generation and documentation
 */
export interface SdkOptions {
  /** The name of the SDK method */
  name: string
  /** HTTP status code for successful responses */
  code?: HttpStatus | number
  /** Path to markdown file for detailed description */
  descMd?: string
  /** Custom API response configurations */
  responses?: ApiResponseConfig[]
  /** SDK version information */
  version?: string
  /** Whether this is an internal-only endpoint */
  internal?: boolean
  /** Whether this endpoint is experimental */
  experimental?: boolean
  /** Whether this endpoint is deprecated */
  deprecated?: boolean
  /** Whether to hide this endpoint from documentation */
  hidden?: boolean
}

/**
 * Configuration options for API route definition
 */
export interface RouteOptions<T = unknown> {
  /** URL path or array of paths for the route */
  path?: string | string[]
  /** Description of the route functionality */
  description?: string
  /** Brief summary for API documentation */
  summary: string
  /** Tags for grouping routes in documentation */
  tags?: string[]
  /** Authentication type(s) required for this route */
  auth?: AuthType | AuthType[]
  /** @deprecated Whether this endpoint is publicly accessible (no auth required) */
  public?: boolean
  /** HTTP method(s) for this route */
  method?: RouteMethod | RouteMethod[]
  /** Authorization scope(s) required */
  scopes?: Scopes | Scopes[]
  /** Audit event configuration for logging */
  audit?: { key: AuditEventKey } & _AuditEvent
  /** Rate limiting configuration */
  throttle?: number | ThrottleOptions
  /** Response model configuration for serialization */
  model?:
    | Type<T>
    | ResolverTypeContextOptions
    | {
        type: Type<T>
        options: ResolverTypeContextOptions
      }
  /**
   * Fields that contain sensitive information and should be redacted in logs.
   */
  sensitiveFields?: (keyof T extends string ? (keyof T)[] : never) | string[]
  /** SDK generation options */
  sdk?: SdkOptions
  /** Unique operation identifier for OpenAPI */
  operationId?: string
  /** Include in Open api schema */
  docs?: boolean
}

const HTTP_METHOD_DECORATORS = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
  OPTIONS: Options,
  HEAD: Head,
  ALL: All,
} as const

const readMarkdownFile = (filePath: string): string | null => {
  try {
    const fullPath = path.join(configuration.app.docsRoot, filePath)
    if (!fs.existsSync(fullPath)) {
      console.warn(`Markdown file not found: ${fullPath}`)
      return null
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8')
    return fileContent.trim()
  } catch (error) {
    console.error(`Error reading markdown file ${filePath}:`, error)
    return null
  }
}

const validateRouteOptions = <T = unknown>(options: RouteOptions<T>): void => {
  if (options.method) {
    const methods = Array.isArray(options.method)
      ? options.method
      : [options.method]
    const invalidMethods = methods.filter(
      method => !Object.keys(HTTP_METHOD_DECORATORS).includes(method),
    )

    if (invalidMethods.length > 0) {
      throw new Error(`Invalid HTTP methods: ${invalidMethods.join(', ')}`)
    }
  }

  if (options.sdk?.responses) {
    const invalidStatuses = options.sdk.responses.filter(
      response =>
        typeof response.status !== 'number' ||
        response.status < 100 ||
        response.status >= 600,
    )

    if (invalidStatuses.length > 0) {
      throw new Error('Invalid HTTP status codes in responses')
    }
  }
}

/**
 * Decorator to define an API route with integrated features like authentication, authorization, auditing, rate limiting, response modeling, and SDK generation.
 *
 * @param options Configuration options for the route
 * @returns A combination of NestJS and custom decorators applied to the route handler
 *
 * @example Create endpoint with detailed options
 * ```typescript
 * @Route({
 *   method: 'POST',
 *   path: '/files',
 *   summary: 'Create file',
 *   scopes: 'files.create',
 *   model: Models.FILE,
 *   throttle: {
 *     limit: configuration.limits.writeRateDefault,
 *     ttl: configuration.limits.writeRatePeriodDefault,
 *     key: ({ req, user, ip }) => [
 *       `ip:${ip}`,
 *       `userId:${user.getId()}`,
 *       `chunkId:${req.headers['x-nuvix-id']}`,
 *     ].join(','),
 *     configKey: 'bucket_files_create',
 *   },
 *   audit: {
 *     key: 'file.create',
 *     resource: 'file/{res.$id}',
 *   },
 *   sdk: {
 *     name: 'createFile',
 *     descMd: '/docs/references/storage/create-file.md',
 *   },
 * })
 * async createFile(
 *
 *   @User() user: Doc,
 *   @Body() createFileDto: CreateFileDto
 * ): Promise<FilesDoc> {
 *   // Implementation here
 * }
 * ```
 *
 * @example List endpoint with response model
 * ```typescript
 * @Route({
 *   method: 'GET',
 *   summary: 'List files',
 *   scopes: 'files.read',
 *   model: { type: Models.FILE, list: true },
 *   sdk: {
 *     name: 'getFiles',
 *     descMd: '/docs/references/storage/list-files.md',
 *   },
 * })
 * ```
 *
 * @example Custom responses for file endpoints
 * ```typescript
 * @Route({
 *   method: 'GET',
 *   path: ':fileId/download',
 *   summary: 'Get file for download',
 *   scopes: 'files.read',
 *   sdk: {
 *     name: 'getFileDownload',
 *     responses: [
 *       {
 *         status: 200,
 *         description: 'Returns the file as binary stream',
 *         contentTypes: ['application/octet-stream'],
 *       },
 *       {
 *         status: 206,
 *         description: 'Partial content (range requests)',
 *         contentTypes: ['application/octet-stream'],
 *       },
 *     ],
 *   },
 * })
 * ```
 */
export const Route = <T = unknown>({
  docs = true,
  ...options
}: RouteOptions<T>) => {
  validateRouteOptions(options)

  const decorators = []

  // -------------------------------
  // 1. HTTP Method & Path
  // -------------------------------
  const methods = options.method
    ? Array.isArray(options.method)
      ? options.method
      : [options.method]
    : ['GET']

  const routePath = options.path || ''

  for (const method of methods) {
    const DecoratorClass =
      HTTP_METHOD_DECORATORS[method as keyof typeof HTTP_METHOD_DECORATORS]
    if (!DecoratorClass) {
      throw new Error(`Unsupported HTTP method: ${method}`)
    }
    decorators.push(DecoratorClass(routePath))
  }

  // -------------------------------
  // 2. Security / Scopes / Audit
  // -------------------------------
  if (options.auth !== undefined) {
    decorators.push(Auth(options.auth))
  }
  if (options.scopes) {
    decorators.push(Scope(options.scopes))
  }
  if (options.audit) {
    const { key, ...rest } = options.audit
    decorators.push(AuditEvent(key as AuditEventKey, rest))
  }
  if (options.throttle) {
    decorators.push(Throttle(options.throttle as any))
    if (docs) {
      const properties: Record<string, any> = {
        limit:
          typeof options.throttle === 'number'
            ? options.throttle
            : options.throttle.limit,
        ...(typeof options.throttle === 'object' ? options.throttle : {}), // -------------- TODO: add default properties
      }
      decorators.push(ApiExtension('x-rateLimit', properties))
    }
  }

  // -------------------------------
  // 3. Response Model
  // -------------------------------
  let responseModel: Type<any> | undefined
  let isList = false

  if (
    options.model &&
    typeof options.model === 'object' &&
    'type' in options.model &&
    'list' in options.model &&
    options.model.list
  ) {
    isList = true
    responseModel = options.model.type
    if (responseModel) {
      decorators.push(ApiExtraModels(responseModel as Type<any>))
    }
  }

  if (options.model) {
    responseModel =
      typeof options.model === 'object' &&
      'type' in options.model &&
      !isList &&
      responseModel !== Models.NONE
        ? options.model.type
        : (options.model as Type<any>)
    decorators.push(ResModel(options.model as any))
  }

  // -------------------------------
  // 4. Markdown → Description
  // -------------------------------
  let description = options.description
  if (options.sdk?.descMd && docs) {
    const markdownContent = readMarkdownFile(options.sdk.descMd)
    if (markdownContent) {
      description = markdownContent
    }
  }

  // -------------------------------
  // 5. Tags & Operation Metadata
  // -------------------------------
  if (options.tags?.length && docs) {
    decorators.push(ApiTags(...options.tags))
  }

  if (docs) {
    decorators.push(
      ApiOperation({
        summary: options.summary || options.description,
        description,
        tags: options.tags,
        deprecated: options.sdk?.deprecated,
        operationId: options.operationId || options.sdk?.name,
      }),
    )
  }

  // -------------------------------
  // 6. Responses
  // -------------------------------
  const defaultCode =
    options.sdk?.code ??
    (methods.includes('POST')
      ? HttpStatus.CREATED
      : methods.includes('HEAD') ||
          methods.includes('OPTIONS') ||
          methods.includes('DELETE')
        ? HttpStatus.NO_CONTENT
        : HttpStatus.OK)
  decorators.push(HttpCode(defaultCode))

  const buildListSchema = (type: any) => ({
    properties: {
      data: {
        type: 'array',
        items: { $ref: getSchemaPath(type) },
      },
      total: { type: 'number' },
    },
  })

  if (!options.sdk?.responses?.length && docs) {
    if (isList) {
      decorators.push(
        ApiResponse({
          status: defaultCode,
          description: 'Successful response',
          schema: buildListSchema(responseModel),
        }),
      )
    } else {
      decorators.push(
        ApiResponse({
          status: defaultCode,
          description: 'Successful response',
          type: responseModel as any,
        }),
      )
    }
  } else if (docs) {
    options.sdk?.responses?.forEach(response => {
      if (response.contentTypes?.length) {
        const content: Record<string, any> = {}
        for (const ct of response.contentTypes) {
          if (
            ct.startsWith('image/') ||
            ct === 'application/pdf' ||
            ct === 'application/octet-stream'
          ) {
            content[ct] = {
              schema: { type: 'string', format: 'binary' },
            }
          } else if (isList && response.type) {
            content[ct] = { schema: buildListSchema(response.type) }
          } else {
            content[ct] = {
              schema: response.type
                ? { $ref: getSchemaPath(response.type) }
                : { type: 'object' },
            }
          }
        }

        decorators.push(
          ApiResponse({
            status: response.status,
            description: response.description,
            content,
          }),
        )
      } else if (isList && response.type) {
        decorators.push(
          ApiResponse({
            status: response.status,
            description: response.description,
            schema: buildListSchema(response.type),
          }),
        )
      } else {
        decorators.push(
          ApiResponse({
            status: response.status,
            description: response.description,
            type: response.type,
          }),
        )
      }
    })
  }

  if (!docs) {
    decorators.push(ApiExcludeEndpoint())
  }

  // -------------------------------
  // 7. Sensitive Fields
  // -------------------------------
  if (options.sensitiveFields) {
    decorators.push(Sensitive(options.sensitiveFields))
  }

  return applyDecorators(...decorators)
}

export const GetRoute = <T = unknown>(
  path: string | string[],
  options: Omit<RouteOptions<T>, 'method' | 'path'>,
) => Route({ ...options, method: 'GET', path })

export const PostRoute = <T = unknown>(
  path: string | string[],
  options: Omit<RouteOptions<T>, 'method' | 'path'>,
) => Route({ ...options, method: 'POST', path })

export const PutRoute = <T = unknown>(
  path: string | string[],
  options: Omit<RouteOptions<T>, 'method' | 'path'>,
) => Route({ ...options, method: 'PUT', path })

export const PatchRoute = <T = unknown>(
  path: string | string[],
  options: Omit<RouteOptions<T>, 'method' | 'path'>,
) => Route({ ...options, method: 'PATCH', path })

export const DeleteRoute = <T = unknown>(
  path: string | string[],
  options: Omit<RouteOptions<T>, 'method' | 'path'>,
) => Route({ ...options, method: 'DELETE', path })

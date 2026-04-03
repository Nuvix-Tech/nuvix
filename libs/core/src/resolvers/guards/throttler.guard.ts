import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Throttle } from '@nuvix/core/decorators'
import {
  AbuseKey,
  AbuseKeyParam,
  configuration,
  KeyArgs,
  ThrottleOptions,
} from '@nuvix/utils'
import { ProjectsDoc, UsersDoc } from '@nuvix/utils/types'
import { Exception } from '../../extend/exception'
import { RatelimitService } from '../../rate-limit.service'

interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetTime: number
}

@Injectable()
export class ThrottlerGuard implements CanActivate {
  constructor(
    private readonly ratelimitService: RatelimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: NuvixRequest = context.switchToHttp().getRequest()
    const response: NuvixRes = context.switchToHttp().getResponse()

    // If throttling is disabled globally, allow all requests
    if (!configuration.app.enableThrottling) {
      return true
    }

    const rateLimitOptions = this.reflector.getAllAndOverride<ThrottleOptions>(
      Throttle.name,
      [context.getClass(), context.getHandler()],
    )
    // If no rate limit options are defined for this route, allow the request
    if (rateLimitOptions === undefined) {
      return true
    }

    const abuseKeys = this.generateAbuseKeys(rateLimitOptions, request)
    const { project, user } = request.context

    let closestResult: RateLimitResult | null = null

    for (const abuseKey of abuseKeys) {
      const rateLimitKey = this.buildRateLimitKey(
        request,
        project,
        user,
        abuseKey,
      )
      const result = await this.ratelimitService.checkRateLimit(rateLimitKey, {
        limit: rateLimitOptions.limit || 0,
        window: rateLimitOptions.ttl ?? 3600,
      })

      if (!closestResult || result.remaining < closestResult.remaining) {
        closestResult = result
      }

      if (!result.allowed) {
        this.setRateLimitHeaders(response, result)
        throw new Exception(Exception.GENERAL_RATE_LIMIT_EXCEEDED).addDetails({
          limit: result.limit,
          remaining: result.remaining,
          reset: result.resetTime,
        })
      }
    }

    if (closestResult) {
      this.setRateLimitHeaders(response, closestResult)
    }

    return true
  }

  private generateAbuseKeys(
    rateLimitOptions: ThrottleOptions,
    request: NuvixRequest,
  ): AbuseKey[] {
    const { key: templateKey } = rateLimitOptions

    if (typeof templateKey === 'function') {
      const keyArgs: KeyArgs = {
        ip: request.ip,
        params: request.params ?? {},
        body: request.body ?? {},
        user: request.context.user,
        req: request,
      }
      const result = templateKey(keyArgs)
      return Array.isArray(result) ? result : [result]
    }

    if (typeof templateKey === 'string') {
      return [templateKey]
    }

    return ['url:{url},ip:{ip}']
  }

  private buildRateLimitKey(
    request: NuvixRequest,
    project: ProjectsDoc,
    user: UsersDoc,
    abuseKey: AbuseKey,
  ): string {
    const processedKey = this.processTemplate(abuseKey, {
      ip: request.ip,
      params: request.params as Record<string, any>,
      body: request.body as Record<string, any>,
      user,
      req: request,
    })

    return `rl:${project.getId() || 'global'}:${processedKey}`
  }

  private processTemplate(template: AbuseKey, args: KeyArgs): string {
    const segments = template.split(',')

    const values = segments.map(segment => {
      const match = segment.match(/\{(.+?)\}/)

      if (!match) return 'unknown'

      const key = match[1] as AbuseKeyParam
      return this.resolveKey(key, args)
    })

    return values.join(':')
  }

  private resolveKey(key: AbuseKeyParam, args: KeyArgs): string {
    const { req, user, body } = args

    if (key === 'ip') return req.ip
    if (key === 'url') return req.routeOptions.config.url
    if (key === 'method') return req.routeOptions.config.method as string
    if (key === 'userId') return user?.getId() || '--'
    if (key === 'chunkId') return this.resolveChunkId(req)

    if (key.startsWith('body-')) {
      const field = key.slice(5)
      const value = body?.[field]

      if (value === undefined) return 'unknown'
      if (Array.isArray(value)) return JSON.stringify(value)

      return String(value)
    }

    return 'unknown'
  }

  private setRateLimitHeaders(
    response: NuvixRes,
    result: RateLimitResult,
  ): void {
    response
      .header('X-RateLimit-Limit', result.limit.toString())
      .header('X-RateLimit-Remaining', result.remaining.toString())
      .header('X-RateLimit-Reset', result.resetTime.toString())
  }

  /**
   * Resolve a unique chunk identifier from the request headers.
   *
   * For chunked uploads the client sends:
   *   - Content-Range: bytes <start>-<end>/<total>
   *   - x-nuvix-id: <fileId>  (for chunks after the first)
   *
   * We combine the file ID and the byte-range start offset to produce
   * a key that is unique per chunk, so that each chunk request gets its
   * own rate-limit bucket instead of all chunks sharing one.
   *
   * For non-chunked (single-request) uploads we fall back to `'single'`.
   */
  private resolveChunkId(req: NuvixRequest): string {
    const contentRange = req.headers['content-range'] as string | undefined
    if (!contentRange) {
      return 'single'
    }

    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange.trim())
    if (!match) {
      return 'unknown'
    }

    const rangeStart = match[1]
    const fileId =
      (Array.isArray(req.headers['x-nuvix-id'])
        ? req.headers['x-nuvix-id'][0]
        : req.headers['x-nuvix-id']) ?? 'unknown'

    return `${fileId}:${rangeStart}`
  }
}

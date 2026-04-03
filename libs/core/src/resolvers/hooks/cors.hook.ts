import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { CoreService } from '@nuvix/core/core.service'
import { AppMode, configuration } from '@nuvix/utils'
import {
  addAccessControlRequestHeadersToVaryHeader,
  addOriginToVaryHeader,
} from '../../helpers/vary.helper'
import { Hook } from '../../server/hooks/interface'
import { Origin } from '../../validators/network/origin'

type OriginMatcher = (origin: string, hostname: string) => boolean

@Injectable()
export class CorsHook implements Hook, OnModuleInit {
  private readonly logger = new Logger(CorsHook.name)

  private originMatchers: OriginMatcher[] = []
  private allowedOriginsSet = new Set<string>()
  private allowWildcard = false

  private allowedHeadersSet = new Set<string>()
  private allowedMethodsSet = new Set<string>()

  private allowedHeadersHeader = ''
  private allowedMethodsHeader = ''
  private exposedHeadersHeader = ''

  private credentials = false
  private maxAge = 3600

  constructor(private readonly coreService: CoreService) {}

  onModuleInit(): void {
    const cfg = configuration.server

    this.credentials = cfg.credentials
    this.maxAge = 3600

    for (const m of cfg.methods) {
      this.allowedMethodsSet.add(m.toUpperCase())
    }

    for (const h of cfg.allowedHeaders) {
      this.allowedHeadersSet.add(h.toLowerCase())
    }

    this.allowedMethodsHeader = cfg.methods.join(', ')
    this.allowedHeadersHeader = cfg.allowedHeaders.join(', ')
    this.exposedHeadersHeader = cfg.exposedHeaders.join(', ')

    this.initializeOriginMatchers(cfg.allowedOrigins ?? [])

    if (this.credentials && this.allowWildcard) {
      throw new Error(
        'Invalid CORS configuration: wildcard origin cannot be used with credentials',
      )
    }
  }

  private initializeOriginMatchers(patterns: string[]): void {
    for (const pattern of patterns) {
      if (pattern === '*') {
        this.allowWildcard = true
        continue
      }

      if (!pattern.includes('*')) {
        this.allowedOriginsSet.add(pattern)
        continue
      }

      this.originMatchers.push(this.compilePattern(pattern))
    }
  }

  private compilePattern(pattern: string): OriginMatcher {
    if (pattern.startsWith('*.')) {
      const domain = pattern.slice(2) // example.com

      return (_, hostname) =>
        hostname === domain || hostname.endsWith(`.${domain}`)
    }

    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i')

    return origin => regex.test(origin)
  }

  async onRequest(req: NuvixRequest, reply: NuvixRes): Promise<void> {
    const origin = req.headers.origin
    if (!origin) return

    try {
      const validOrigin = this.determineOrigin(origin, req)

      if (!validOrigin) {
        if (req.method === 'OPTIONS') {
          this.removeCorsHeaders(reply)
          reply.status(403).send('Origin not allowed')
        }
        return
      }

      this.setCorsHeaders(reply, validOrigin)

      if (req.method === 'OPTIONS') {
        this.handlePreflight(req, reply, validOrigin)
      }
    } catch (err) {
      this.logger.error(`CORS failure for origin "${origin}": ${err}`)
      reply.status(500).send('Internal Server Error')
    }
  }

  private determineOrigin(origin: string, req: NuvixRequest): string | false {
    const isConsole =
      this.coreService.isConsole() || req.context.mode === AppMode.ADMIN

    if (isConsole) {
      let parsed: URL
      try {
        parsed = new URL(origin)

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return false
        }
      } catch {
        return false
      }
      return this.matchConsoleOrigin(origin, parsed.hostname) ? origin : false
    }

    const allowedHostnames = req.context.getAllowedHostnames()
    const allowedSchemes = req.context.getAllowedSchemes()

    if (allowedHostnames.length === 0) {
      return false
    }

    const validator = new Origin(allowedHostnames, allowedSchemes)
    return validator.$valid(origin) ? origin : false
  }

  private matchConsoleOrigin(origin: string, hostname: string): boolean {
    if (this.allowWildcard) return true
    if (this.allowedOriginsSet.has(origin)) return true

    for (const matcher of this.originMatchers) {
      if (matcher(origin, hostname)) return true
    }

    return false
  }

  private setCorsHeaders(reply: NuvixRes, origin: string): void {
    const headers = reply.raw

    const allowOrigin = this.credentials ? origin : origin || null

    if (allowOrigin) {
      headers.setHeader('Access-Control-Allow-Origin', allowOrigin)
    }

    if (this.credentials) {
      headers.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (this.exposedHeadersHeader) {
      headers.setHeader(
        'Access-Control-Expose-Headers',
        this.exposedHeadersHeader,
      )
    }

    addOriginToVaryHeader(reply)
    addAccessControlRequestHeadersToVaryHeader(reply)
  }

  private handlePreflight(
    req: NuvixRequest,
    reply: NuvixRes,
    origin: string,
  ): void {
    const requestedMethod =
      req.headers['access-control-request-method']?.toUpperCase()

    if (!requestedMethod) {
      reply.status(400).send('Invalid Preflight Request')
      return
    }

    if (!this.allowedMethodsSet.has(requestedMethod)) {
      reply.status(405).send('Method not allowed')
      return
    }

    const requestedHeaders = req.headers['access-control-request-headers']

    let allowHeaders = this.allowedHeadersHeader

    if (requestedHeaders) {
      const requested = requestedHeaders
        .split(',')
        .map(h => h.trim().toLowerCase())

      const filtered = requested.filter(h => this.allowedHeadersSet.has(h))

      if (filtered.length !== requested.length) {
        reply.status(400).send('Headers not allowed')
        return
      }

      allowHeaders = filtered.join(', ')
    }

    const headers = reply.raw

    headers.setHeader('Access-Control-Allow-Origin', origin)
    headers.setHeader('Access-Control-Allow-Methods', this.allowedMethodsHeader)
    headers.setHeader('Access-Control-Allow-Headers', allowHeaders)
    headers.setHeader('Access-Control-Max-Age', String(this.maxAge))

    if (this.credentials) {
      headers.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    reply.status(204).header('Content-Length', '0').send()
  }

  private removeCorsHeaders(reply: NuvixRes): void {
    const headers = reply.raw

    headers.removeHeader('Access-Control-Allow-Origin')
    headers.removeHeader('Access-Control-Allow-Credentials')
    headers.removeHeader('Access-Control-Expose-Headers')
    headers.removeHeader('Access-Control-Allow-Headers')
    headers.removeHeader('Access-Control-Allow-Methods')
    headers.removeHeader('Access-Control-Max-Age')
  }
}

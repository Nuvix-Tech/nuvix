import fastify from 'fastify';
import type {
  FastifyReply,
  FastifyRequest,
  RequestRouteOptions,
  SchemaCompiler,
  FastifyContextConfig,
  FastifyRouteConfig,
} from 'fastify';
import type { Entities as NuvixEntities } from './libs/utils/types';
import type { RouteContext, ThrottleOptions } from './libs/utils/src';
import type { AuditEventType } from './libs/core/src/decorators';
import { SchemaType } from '@nuvix/pg';
import type { RequestContext } from '@nuvix/core/helpers/context.helper';

declare module 'fastify' {
  interface FastifyContextConfig {
    [RouteContext.AUDIT]?: AuditEventType;
    [RouteContext.SKIP_LOGGING]?: boolean;
    [RouteContext.SCHEMA_TYPE]?: SchemaType[] | SchemaType;
  }

  interface FastifyRouteConfig extends FastifyContextConfig {

  }

  interface FastifyRequest {
    routeOptions: RequestRouteOptions<
      {
        hooks?: {
          [key: string]: { args: Array<any>; };
        };
      },
      SchemaCompiler
    >;
    context: RequestContext;
    // Allow storing hooks arguments and other arbitrary properties
    hooks_args: Record<string, any>;
    requestSize?: () => number;
    rate_limit?: {
      limit: number;
      remaining: number;
      reset: number; // timestamp
    }
    // Index signature to allow bracket notation access with string keys
    // [key: string | symbol]: any;
  }
}

declare global {
  export type NuvixRequest = FastifyRequest;
  export type NuvixRes = FastifyReply;
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

declare module '@nuvix/db' {
  export interface Entities extends NuvixEntities {}
}

interface ImportMetaEnv {
  [key: string]: string;
}

export {};

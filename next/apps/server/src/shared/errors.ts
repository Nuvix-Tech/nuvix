/**
 * Application errors mapped to RFC-9457 problem+json responses.
 *
 * Every thrown `AppError` is converted by the Elysia error handler in
 * `app.ts` into a `application/problem+json` body:
 *
 *   { type, title, status, detail, code?, instance?, errors? }
 *
 * Two-layer error identity (Stripe-style):
 * - `type` — coarse class (`/errors/not-found`, `/errors/conflict`, …).
 *   Generic middleware, retry/backoff, and auth-flow logic key off this
 *   (or off `status`).
 * - `code` — stable, flat, snake_case machine code (`user_not_found`,
 *   `schema_already_exists`, …). THE public contract: SDKs and consoles
 *   branch on this. Additive changes only; never parse `detail`.
 */
export interface ProblemFields {
  /** Coarse problem class URI, e.g. `/errors/not-found`. */
  type: string
  /**
   * Stable machine-readable error code (snake_case), e.g. `user_not_found`.
   * This is what clients branch on — the public contract.
   */
  code?: string
  /** Short human-readable summary (maps to HTTP status reason). */
  title?: string
  /** Human-readable explanation for this occurrence (English fallback). */
  detail?: string
  /**
   * Translation key for a localized `detail` (e.g. `errors.project.notFound`).
   * Translated at serialization time via the request locale; `detail` remains
   * the English fallback when no translation exists.
   */
  messageKey?: string
  /** Interpolation params for `messageKey` (ICU syntax). */
  params?: Record<string, string | number | Date>
  /** Per-field / per-item validation details. */
  errors?: Array<{ field?: string; message: string }>
}

export class AppError extends Error {
  readonly status: number
  readonly fields: ProblemFields

  constructor(status: number, fields: ProblemFields) {
    super(fields.detail ?? fields.title ?? 'Unknown error')
    this.name = new.target.name
    this.status = status
    this.fields = fields
  }
}

export class BadRequestError extends AppError {
  constructor(detail: string, fields?: Omit<ProblemFields, 'type' | 'detail'>) {
    super(400, { type: '/errors/bad-request', detail, ...fields })
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Authentication required', fields?: Omit<ProblemFields, 'type' | 'detail'>) {
    super(401, { type: '/errors/unauthorized', detail, ...fields })
  }
}

export class ForbiddenError extends AppError {
  constructor(
    detail = 'Insufficient permissions',
    fields?: Omit<ProblemFields, 'type' | 'detail'>,
  ) {
    super(403, { type: '/errors/forbidden', detail, ...fields })
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', fields?: Omit<ProblemFields, 'type' | 'detail'>) {
    super(404, {
      type: '/errors/not-found',
      detail: `${resource} not found`,
      ...fields,
    })
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, fields?: Omit<ProblemFields, 'type' | 'detail'>) {
    super(409, { type: '/errors/conflict', detail, ...fields })
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(detail = 'Service unavailable', fields?: Omit<ProblemFields, 'type' | 'detail'>) {
    super(503, { type: '/errors/unavailable', detail, ...fields })
  }
}

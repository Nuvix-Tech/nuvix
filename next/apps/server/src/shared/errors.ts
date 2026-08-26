/**
 * Application errors mapped to RFC-9457 problem+json responses.
 *
 * Every thrown `AppError` is converted by the Elysia error handler in
 * `app.ts` into a `application/problem+json` body:
 *
 *   { type, title, status, detail, instance?, errors? }
 */

export interface ProblemFields {
  /** URI identifying the problem class, e.g. `/errors/invalid-credentials`. */
  type: string
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
  constructor(detail = 'Authentication required') {
    super(401, { type: '/errors/unauthorized', detail })
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'Insufficient permissions') {
    super(403, { type: '/errors/forbidden', detail })
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

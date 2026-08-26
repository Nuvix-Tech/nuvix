import type { Translator } from '@nuvix/i18n'
import { Elysia, problem } from 'elysia'
import { AppError } from '../shared/errors'

export interface ProblemErrorsOptions {
  /** Resolves the request's translator for localized error details. */
  getTranslator: (headers: Headers) => Promise<Translator>
}

/**
 * Maps application errors to RFC-9457 problem+json responses.
 *
 * When an `AppError` carries `messageKey`, the `detail` is translated via the
 * request locale (D32/D34); the English `detail` remains the fallback.
 *
 * NOTE (elysia@2.0.0-beta.6):
 * - v2 replaced `.onError` with `.error(ErrorClass, handler)` registration.
 * - Error handlers registered inside a plugin MUST use `global` scope,
 *   otherwise they do not propagate to the consuming instance's routes.
 */
export function problemErrors(options: ProblemErrorsOptions) {
  return new Elysia({ name: 'problem-errors' }).error(
    'global',
    AppError,
    async ({ error, set, request }) => {
      let detail = error.fields.detail
      if (error.fields.messageKey) {
        try {
          const translator = await options.getTranslator(request.headers)
          detail = translator.format(error.fields.messageKey, error.fields.params)
        } catch {
          // Translation failures must never mask the original error.
        }
      }

      set.status = error.status
      return problem(error.status, {
        type: error.fields.type,
        title: error.fields.title,
        detail,
        instance: error.message,
        errors: error.fields.errors,
      })
    },
  )
}

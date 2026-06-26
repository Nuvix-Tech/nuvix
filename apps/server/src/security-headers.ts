import { NestFastifyApplication } from '@nestjs/platform-fastify'

/**
 * Security headers middleware for Nuvix.
 * Implements OWASP-recommended HTTP security headers.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
 */
export async function registerSecurityHeaders(app: NestFastifyApplication) {
  const httpAdapter = app.getHttpAdapter()
  const fastifyApp = httpAdapter.getInstance()

  fastifyApp.addHook('onResponse', async (request: any, reply: any) => {
    // Prevent XSS attacks by controlling which resources can execute
    // 'self' = only resources from same origin
    // 'unsafe-inline' = allows inline scripts (needed for some OAuth flows)
    // TODO: Tighten to nonce-based CSP in production
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none';",
    )

    // Enforce HTTPS with HSTS (1 year, include subdomains)
    // Prevents protocol downgrade attacks and cookie theft via MITM
    reply.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    )

    // Prevent clickjacking attacks by disabling iframe embedding
    reply.header('X-Frame-Options', 'DENY')

    // Prevent MIME type sniffing (always trust declared Content-Type)
    reply.header('X-Content-Type-Options', 'nosniff')

    // Legacy XSS protection (still useful for older browsers)
    reply.header('X-XSS-Protection', '1; mode=block')

    // Prevent referrer leakage on navigation
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')

    // Control browser features/permissions
    reply.header(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    )

    // Cross-Origin policies
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('Cross-Origin-Embedder-Policy', 'require-corp')
  })
}

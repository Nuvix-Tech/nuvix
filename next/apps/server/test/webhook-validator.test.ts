import { describe, expect, test } from 'bun:test'
import { isBlockedHost, validateWebhookUrl } from '../src/webhooks/validator'

describe('Webhook SSRF URL Validator', () => {
  test('accepts valid public HTTP and HTTPS URLs', () => {
    expect(validateWebhookUrl('https://api.example.com/webhook')).toBe(
      'https://api.example.com/webhook',
    )
    expect(validateWebhookUrl('http://hooks.slack.com/services/T00/B00/X00')).toBe(
      'http://hooks.slack.com/services/T00/B00/X00',
    )
    expect(validateWebhookUrl('https://142.250.190.46/webhook')).toBe(
      'https://142.250.190.46/webhook',
    )
  })

  test('rejects loopback and private IPv4 ranges', () => {
    expect(() => validateWebhookUrl('http://127.0.0.1/webhook')).toThrow()
    expect(() => validateWebhookUrl('http://127.0.1.1:8080/hook')).toThrow()
    expect(() => validateWebhookUrl('http://10.0.0.5/api')).toThrow()
    expect(() => validateWebhookUrl('http://192.168.1.100/notify')).toThrow()
    expect(() => validateWebhookUrl('http://172.16.0.1/test')).toThrow()
    expect(() => validateWebhookUrl('http://172.31.255.255/hook')).toThrow()
  })

  test('rejects AWS/GCP cloud metadata IP (169.254.169.254)', () => {
    expect(() => validateWebhookUrl('http://169.254.169.254/latest/meta-data')).toThrow()
    expect(() => validateWebhookUrl('http://169.254.1.1/hook')).toThrow()
  })

  test('rejects localhost and internal domain names', () => {
    expect(() => validateWebhookUrl('http://localhost/webhook')).toThrow()
    expect(() => validateWebhookUrl('http://sub.localhost/webhook')).toThrow()
    expect(() => validateWebhookUrl('http://service.local/webhook')).toThrow()
    expect(() => validateWebhookUrl('http://database.internal/webhook')).toThrow()
  })

  test('rejects IPv6 loopback, link-local, and mapped addresses', () => {
    expect(() => validateWebhookUrl('http://[::1]/hook')).toThrow()
    expect(() => validateWebhookUrl('http://[::]/hook')).toThrow()
    expect(() => validateWebhookUrl('http://[fe80::1]/hook')).toThrow()
    expect(() => validateWebhookUrl('http://[fc00::1]/hook')).toThrow()
    expect(() => validateWebhookUrl('http://[::ffff:127.0.0.1]/hook')).toThrow()
    expect(() => validateWebhookUrl('http://[::ffff:10.0.0.1]/hook')).toThrow()
  })

  test('rejects embedded credentials in URL', () => {
    expect(() => validateWebhookUrl('https://admin:secret@api.example.com/hook')).toThrow()
    expect(() => validateWebhookUrl('http://user@example.com/hook')).toThrow()
  })

  test('rejects non-http(s) schemes', () => {
    expect(() => validateWebhookUrl('ftp://example.com/hook')).toThrow()
    expect(() => validateWebhookUrl('file:///etc/passwd')).toThrow()
    expect(() => validateWebhookUrl('javascript:alert(1)')).toThrow()
  })

  test('isBlockedHost directly handles hostnames and IPs', () => {
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('api.localhost')).toBe(true)
    expect(isBlockedHost('cluster.internal')).toBe(true)
    expect(isBlockedHost('my-host.local')).toBe(true)
    expect(isBlockedHost('127.0.0.1')).toBe(true)
    expect(isBlockedHost('8.8.8.8')).toBe(false)
    expect(isBlockedHost('example.com')).toBe(false)
  })
})

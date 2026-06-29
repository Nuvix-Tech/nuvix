import { describe, expect, it } from 'vitest'
import type { WebhooksDoc } from '@nuvix/utils/types'
import {
  eventMatchesPattern,
  webhookSubscribesToEvent,
} from './webhooks.service'

describe('WebhooksService event matching', () => {
  it('matches exact event', () => {
    expect(
      eventMatchesPattern('database.documents.read', 'database.documents.read'),
    ).toBe(true)
  })

  it('matches wildcard root', () => {
    expect(eventMatchesPattern('database.documents.read', '*')).toBe(true)
  })

  it('matches wildcard segment at start', () => {
    expect(
      eventMatchesPattern('database.__Id__.documents.read', '*.documents.read'),
    ).toBe(true)
  })

  it('matches wildcard segment in middle', () => {
    expect(
      eventMatchesPattern('database.documents.read', 'database.*.read'),
    ).toBe(true)
  })

  it('does not match shorter pattern', () => {
    expect(
      eventMatchesPattern('database.documents.read', 'database.read'),
    ).toBe(false)
  })

  it('does not match longer pattern', () => {
    expect(
      eventMatchesPattern(
        'database.documents.read',
        'database.*.documents.read',
      ),
    ).toBe(false)
  })

  it('matches event with multiple wildcards', () => {
    expect(eventMatchesPattern('database.documents.read', 'database.*.*')).toBe(
      true,
    )
  })

  it('matches trailing wildcard as prefix catch-all', () => {
    expect(eventMatchesPattern('database.documents.read', 'database.*')).toBe(
      true,
    )
    expect(
      eventMatchesPattern('database.documents.read', 'database.documents.*'),
    ).toBe(true)
    expect(eventMatchesPattern('database.documents.read', '*.read')).toBe(true)
  })

  it('does not match when prefix differs', () => {
    expect(eventMatchesPattern('database.documents.read', 'storage.*')).toBe(
      false,
    )
  })

  it('matches webhook subscription array patterns', () => {
    const webhook = {
      get: (key: string, defaultValue?: unknown) =>
        key === 'events'
          ? ['database.*.read', '*.documents.*', '*']
          : defaultValue,
    } as unknown as WebhooksDoc

    expect(webhookSubscribesToEvent(webhook, 'database.documents.read')).toBe(
      true,
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { eventMatchesPattern, webhookSubscribesToEvent } from '../src/webhooks/matcher'

describe('Webhook Event Matcher', () => {
  test('matches global wildcard *', () => {
    expect(eventMatchesPattern('users.create', '*')).toBe(true)
    expect(eventMatchesPattern('database.documents.update', '*')).toBe(true)
    expect(eventMatchesPattern('messaging.messages.send', '*')).toBe(true)
  })

  test('matches exact event string', () => {
    expect(eventMatchesPattern('users.create', 'users.create')).toBe(true)
    expect(eventMatchesPattern('users.delete', 'users.create')).toBe(false)
  })

  test('matches prefix and suffix wildcards', () => {
    expect(eventMatchesPattern('users.create', 'users.*')).toBe(true)
    expect(eventMatchesPattern('users.update', 'users.*')).toBe(true)
    expect(eventMatchesPattern('users.delete', 'users.*')).toBe(true)
    expect(eventMatchesPattern('teams.create', 'users.*')).toBe(false)

    expect(eventMatchesPattern('storage.buckets.create', '*.create')).toBe(true)
    expect(eventMatchesPattern('users.create', '*.create')).toBe(true)
    expect(eventMatchesPattern('users.delete', '*.create')).toBe(false)
  })

  test('matches deep segment wildcards', () => {
    const pattern = 'database.collections.*.documents.*'
    expect(eventMatchesPattern('database.collections.posts.documents.create', pattern)).toBe(true)
    expect(eventMatchesPattern('database.collections.users.documents.update', pattern)).toBe(true)
    expect(eventMatchesPattern('database.schemas.create', pattern)).toBe(false)
  })

  test('webhookSubscribesToEvent matches if any pattern matches', () => {
    const events = ['users.create', 'storage.*']
    expect(webhookSubscribesToEvent(events, 'users.create')).toBe(true)
    expect(webhookSubscribesToEvent(events, 'storage.files.upload')).toBe(true)
    expect(webhookSubscribesToEvent(events, 'teams.create')).toBe(false)
  })

  test('rejects empty or overly long patterns', () => {
    expect(eventMatchesPattern('', 'users.create')).toBe(false)
    expect(eventMatchesPattern('users.create', '')).toBe(false)
    expect(eventMatchesPattern('users.create', 'a'.repeat(300))).toBe(false)
  })
})

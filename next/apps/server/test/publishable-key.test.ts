import { describe, expect, test } from 'bun:test'
import { createPublishableKey, parsePublishableKey } from '../src/context/publishable-key'

describe('publishable project key', () => {
  test.each(['test', 'live'] as const)('round-trips a %s project locator', (environment) => {
    const key = createPublishableKey('project_demo', environment)

    expect(key).toBe(`pk_${environment}_djE6cHJvamVjdF9kZW1v`)
    expect(parsePublishableKey(key)).toEqual({
      environment,
      projectId: 'project_demo',
    })
  })

  test('rejects an environment mismatch', () => {
    const key = createPublishableKey('project_demo', 'test')

    expect(parsePublishableKey(key, 'live')).toBeNull()
  })

  test.each([
    null,
    '',
    'project_demo',
    'pk_dev_djE6cHJvamVjdF9kZW1v',
    'pk_test_djE6cHJvamVjdF9kZW1v=',
    'pk_test_not+base64',
    'pk_test_djI6cHJvamVjdF9kZW1v',
    'pk_test_djE6LXByb2plY3Q',
  ])('rejects malformed locator %s', (value) => {
    expect(parsePublishableKey(value)).toBeNull()
  })

  test('rejects invalid project IDs when creating keys', () => {
    expect(() => createPublishableKey('-invalid', 'test')).toThrow('Project identifier is invalid')
  })

  test('returns only public locator data', () => {
    const parsed = parsePublishableKey(createPublishableKey('project_demo', 'live'))

    expect(Object.keys(parsed!)).toEqual(['environment', 'projectId'])
    expect(Object.isFrozen(parsed)).toBe(true)
  })
})

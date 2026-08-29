import { describe, expect, test } from 'bun:test'
import { createProjectResolver, type ProjectResolverAuth } from '../src/project-resolver'
import type { ProjectCredential, ProjectRepository, PublicProject } from '../src/projects'

const PROJECT_ID = 'project_demo'
const INTERNAL_ID = '5dc1c4ab-f7cd-44a0-ae30-46f71dc10766'
const REPOSITORY_SECRET = 'postgresql://registry-secret@database.internal/platform'

interface RepositoryCall {
  readonly operation: 'resolve' | 'verifyBinding'
  readonly publicProjectId: string
  readonly credential?: ProjectCredential
}

interface RepositoryFake {
  readonly repository: ProjectRepository
  readonly calls: RepositoryCall[]
}

function fakeRepository(
  options: {
    readonly project?: PublicProject | null
    readonly bound?: boolean
    readonly resolveError?: Error
    readonly bindingError?: Error
  } = {},
): RepositoryFake {
  const calls: RepositoryCall[] = []
  const repository: ProjectRepository = {
    resolve: async (publicProjectId) => {
      calls.push({ operation: 'resolve', publicProjectId })
      if (options.resolveError) throw options.resolveError
      return options.project === undefined ? { id: publicProjectId } : options.project
    },
    verifyBinding: async (publicProjectId, auth) => {
      calls.push({
        operation: 'verifyBinding',
        publicProjectId,
        credential: auth,
      })
      if (options.bindingError) throw options.bindingError
      return options.bound ?? true
    },
  }
  return { repository, calls }
}

function expectRedacted(error: unknown, original: Error): void {
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected an Error')

  expect(error).not.toBe(original)
  expect(error.message).toBe('Platform project resolution failed')
  expect(error.cause).toBeUndefined()
  const observable = `${error.name}\n${error.message}\n${error.stack ?? ''}`
  expect(observable).not.toContain(REPOSITORY_SECRET)
  expect(observable).not.toContain(INTERNAL_ID)
  expect(observable).not.toContain(original.message)
}

describe('createProjectResolver', () => {
  test('returns only safe project metadata for a guest', async () => {
    const project = {
      id: PROJECT_ID,
      internalId: INTERNAL_ID,
      enabled: true,
      capabilities: { registry: 'must-not-escape' },
    } as PublicProject
    const fake = fakeRepository({ project })

    const result = await createProjectResolver(fake.repository).resolve(PROJECT_ID, {
      type: 'guest',
    })

    expect(result).toEqual({ type: 'found', project: { id: PROJECT_ID } })
    expect(Object.keys(result)).toEqual(['type', 'project'])
    expect(result.type === 'found' ? Object.keys(result.project) : []).toEqual(['id'])
    expect(JSON.stringify(result)).not.toContain(INTERNAL_ID)
    expect(JSON.stringify(result)).not.toContain('capabilities')
    expect(fake.calls).toEqual([{ operation: 'resolve', publicProjectId: PROJECT_ID }])
  })

  const authenticated: ReadonlyArray<{
    readonly name: string
    readonly auth: ProjectResolverAuth
    readonly expectedCredential: ProjectCredential
  }> = [
    {
      name: 'session',
      auth: { type: 'session', sessionId: 'session-1', userId: 'user-1' },
      expectedCredential: {
        type: 'session',
        sessionId: 'session-1',
        userId: 'user-1',
      },
    },
    {
      name: 'JWT',
      auth: {
        type: 'jwt',
        userId: 'user-2',
        sessionId: 'claimed-session-for-other-project',
      },
      expectedCredential: { type: 'jwt', userId: 'user-2' },
    },
    {
      name: 'API key',
      auth: { type: 'apiKey', keyId: 'key-1', mode: 'console' },
      expectedCredential: { type: 'apiKey', keyId: 'key-1', mode: 'console' },
    },
  ]

  for (const entry of authenticated) {
    test(`independently verifies a bound ${entry.name} after project lookup`, async () => {
      const fake = fakeRepository()

      const result = await createProjectResolver(fake.repository).resolve(PROJECT_ID, entry.auth)

      expect(result).toEqual({ type: 'found', project: { id: PROJECT_ID } })
      expect(fake.calls).toEqual([
        { operation: 'resolve', publicProjectId: PROJECT_ID },
        {
          operation: 'verifyBinding',
          publicProjectId: PROJECT_ID,
          credential: entry.expectedCredential,
        },
      ])
    })

    test(`returns forbidden only for a mismatched ${entry.name}`, async () => {
      const fake = fakeRepository({ bound: false })

      const result = await createProjectResolver(fake.repository).resolve(PROJECT_ID, entry.auth)

      expect(result).toEqual({ type: 'forbidden' })
      expect(Object.keys(result)).toEqual(['type'])
      expect(fake.calls).toHaveLength(2)
    })
  }

  test('does not trust a malicious JWT session claim as project authority', async () => {
    const claimedProjectId = 'project_attacker_selected'
    const fake = fakeRepository({ bound: false })

    const result = await createProjectResolver(fake.repository).resolve(PROJECT_ID, {
      type: 'jwt',
      userId: 'verified-user',
      sessionId: claimedProjectId,
    })

    expect(result).toEqual({ type: 'forbidden' })
    expect(fake.calls[1]).toEqual({
      operation: 'verifyBinding',
      publicProjectId: PROJECT_ID,
      credential: { type: 'jwt', userId: 'verified-user' },
    })
    expect(JSON.stringify(fake.calls[1])).not.toContain(claimedProjectId)
  })

  test('makes unknown and disabled projects equivalent and skips binding verification', async () => {
    const unknown = fakeRepository({ project: null })
    const disabled = fakeRepository({ project: null, bound: true })
    const auth: ProjectResolverAuth = {
      type: 'session',
      sessionId: 'session-1',
      userId: 'user-1',
    }

    const unknownResult = await createProjectResolver(unknown.repository).resolve(PROJECT_ID, auth)
    const disabledResult = await createProjectResolver(disabled.repository).resolve(
      PROJECT_ID,
      auth,
    )

    expect(unknownResult).toEqual({ type: 'not-found' })
    expect(disabledResult).toEqual(unknownResult)
    expect(unknown.calls).toEqual([{ operation: 'resolve', publicProjectId: PROJECT_ID }])
    expect(disabled.calls).toEqual(unknown.calls)
  })

  test('redacts project lookup failures without collapsing them into an outcome', async () => {
    const original = new Error(`lookup failed: ${REPOSITORY_SECRET}; ${INTERNAL_ID}`)
    const fake = fakeRepository({ resolveError: original })

    const error = await createProjectResolver(fake.repository)
      .resolve(PROJECT_ID, { type: 'guest' })
      .catch((caught: unknown) => caught)

    expectRedacted(error, original)
    expect(fake.calls).toEqual([{ operation: 'resolve', publicProjectId: PROJECT_ID }])
  })

  for (const entry of authenticated) {
    test(`redacts ${entry.name} binding failures without returning forbidden`, async () => {
      const original = new Error(`binding failed: ${REPOSITORY_SECRET}; ${INTERNAL_ID}`)
      const fake = fakeRepository({ bindingError: original })

      const error = await createProjectResolver(fake.repository)
        .resolve(PROJECT_ID, entry.auth)
        .catch((caught: unknown) => caught)

      expectRedacted(error, original)
      expect(fake.calls).toHaveLength(2)
    })
  }

  test('exposes only the resolver capability', () => {
    const resolver = createProjectResolver(fakeRepository().repository)

    expect(Object.keys(resolver)).toEqual(['resolve'])
  })
})

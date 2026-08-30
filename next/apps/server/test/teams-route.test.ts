import { describe, expect, test } from 'bun:test'
import type { Session } from '@nuvix/db'
import { Elysia } from 'elysia'
import type { ProjectAuthContext } from '../src/context/project'
import type { SchemaService } from '../src/database/service'
import type { DatabaseRequestCapabilities } from '../src/infrastructure/database-composition'
import { problemErrors } from '../src/plugins/errors'
import { teamRoutes } from '../src/teams/route'
import type { TeamService } from '../src/teams/service'

const TEAM = {
  $id: 'team_a',
  name: 'Core',
  total: 1,
  prefs: {},
  $createdAt: '2026-08-29T12:00:00.000Z',
  $updatedAt: '2026-08-29T12:00:00.000Z',
}

function probe(auth: ProjectAuthContext) {
  const calls: string[] = []
  const requests: DatabaseRequestCapabilities = {
    withProject: async (_headers, operation) =>
      await operation({
        project: { id: 'project_a', enabled: true },
        auth,
        session: {} as Session,
        schemas: Object.freeze({}) as SchemaService,
      }),
  }
  const service = {
    create: async () => {
      calls.push('create')
      return TEAM
    },
    list: async () => {
      calls.push('list')
      return { data: [TEAM], meta: { total: 1, limit: 25, offset: 0 } }
    },
    get: async () => {
      calls.push('get')
      return TEAM
    },
    update: async () => {
      calls.push('update')
      return TEAM
    },
    remove: async () => {
      calls.push('remove')
    },
    getPrefs: async () => {
      calls.push('getPrefs')
      return {}
    },
    updatePrefs: async () => {
      calls.push('updatePrefs')
      return { theme: 'dark' }
    },
  } as unknown as TeamService
  const app = new Elysia({ prefix: '/v2' })
    .use(
      problemErrors({
        getTranslator: async () => ({ format: (key: string) => key }) as never,
      }),
    )
    .use(teamRoutes(requests, service))
  return { app, calls }
}

describe('teams routes', () => {
  test('creates a team with 201 through project scope', async () => {
    const state = probe({
      type: 'session',
      sessionId: 'session_a',
      userId: 'user_a',
      verified: true,
      scopes: [],
    })

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Core' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(TEAM)
    expect(state.calls).toEqual(['create'])
  })

  test('rejects guests before invoking the service', async () => {
    const state = probe({ type: 'guest' })

    const response = await state.app.handle(new Request('http://nuvix.test/v2/teams'))

    expect(response.status).toBe(403)
    expect(state.calls).toEqual([])
  })

  test('enforces API-key scopes', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: [],
    })

    const response = await state.app.handle(new Request('http://nuvix.test/v2/teams'))

    expect(response.status).toBe(403)
    expect(state.calls).toEqual([])
  })

  test('validates requests before service invocation', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['teams.write'],
    })

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      }),
    )

    expect(response.status).toBe(422)
    expect(state.calls).toEqual([])
  })

  test('returns 204 after deletion', async () => {
    const state = probe({
      type: 'apiKey',
      keyId: 'key_a',
      mode: 'admin',
      scopes: ['teams.write'],
    })

    const response = await state.app.handle(
      new Request('http://nuvix.test/v2/teams/team_a', { method: 'DELETE' }),
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(state.calls).toEqual(['remove'])
  })
})

import { describe, expect, test } from 'bun:test'
import type { ProjectContext, ProjectResolver } from '../src/context/project'
import { createProjectLocator } from '../src/context/project-locator'
import { createPublishableKey } from '../src/context/publishable-key'
import { HEADERS } from '../src/shared/constants'

function harness(result: ProjectContext | null | Error) {
  const projectIds: string[] = []
  const projects: ProjectResolver = {
    resolve: async (projectId) => {
      projectIds.push(projectId)
      if (result instanceof Error) throw result
      return result
    },
  }
  return { locator: createProjectLocator(projects, 'test'), projectIds }
}

function headers(publishableKey?: string): Headers {
  return new Headers(publishableKey ? { [HEADERS.publishableKey]: publishableKey } : {})
}

describe('publishable-key project locator', () => {
  test('decodes the key and returns only safe enabled project context', async () => {
    const state = harness({ id: 'project_demo', enabled: true })

    const project = await state.locator.resolve(
      headers(createPublishableKey('project_demo', 'test')),
    )

    expect(project).toEqual({ id: 'project_demo', enabled: true })
    expect(state.projectIds).toEqual(['project_demo'])
    expect(Object.isFrozen(project)).toBe(true)
  })

  test.each([
    ['missing', undefined, 'publishable_key_required'],
    ['malformed', 'not-a-publishable-key', 'publishable_key_invalid'],
    ['wrong environment', createPublishableKey('project_demo', 'live'), 'publishable_key_invalid'],
  ] as const)('returns a stable 400 code for a %s key', async (_case, key, code) => {
    const state = harness({ id: 'project_demo', enabled: true })

    const failure = await state.locator.resolve(headers(key)).catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(400)
    expect((failure as { fields: { code?: string } }).fields.code).toBe(code)
    expect(state.projectIds).toEqual([])
  })

  test.each([
    ['unknown', null],
    ['disabled', { id: 'project_demo', enabled: false }],
  ] as const)('hides an %s project behind project_not_found', async (_case, result) => {
    const state = harness(result)

    const failure = await state.locator
      .resolve(headers(createPublishableKey('project_demo', 'test')))
      .catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(404)
    expect((failure as { fields: { code?: string } }).fields.code).toBe('project_not_found')
  })

  test('redacts platform lookup failures as project_unavailable', async () => {
    const state = harness(new Error('postgresql://user:secret@example.test/platform'))

    const failure = await state.locator
      .resolve(headers(createPublishableKey('project_demo', 'test')))
      .catch((error: unknown) => error)

    expect((failure as { status: number }).status).toBe(503)
    expect((failure as { fields: { code?: string } }).fields.code).toBe('project_unavailable')
    expect(String(failure)).not.toContain('secret')
  })

  test('does not treat the secret API key as a project locator', async () => {
    const state = harness({ id: 'project_demo', enabled: true })
    const requestHeaders = new Headers({
      [HEADERS.apiKey]: 'secret_project_api_key',
    })

    const failure = await state.locator.resolve(requestHeaders).catch((error: unknown) => error)

    expect((failure as { fields: { code?: string } }).fields.code).toBe('publishable_key_required')
    expect(state.projectIds).toEqual([])
  })
})

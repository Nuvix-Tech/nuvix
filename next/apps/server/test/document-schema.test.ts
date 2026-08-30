import { describe, expect, test } from 'bun:test'
import { DatabaseException } from '@nuvix/db'
import {
  createDocumentSchemaBootstrap,
  type DocumentSchemaAdmin,
} from '../src/database/document-schema'

function harness(create?: DocumentSchemaAdmin['create']) {
  const names: Array<string | undefined> = []
  const admin: DocumentSchemaAdmin = {
    create:
      create ??
      (async (name) => {
        names.push(name)
      }),
  }

  return {
    admin,
    bootstrap: createDocumentSchemaBootstrap(admin),
    names,
  }
}

describe('document schema bootstrap', () => {
  test('initializes the requested schema through the narrow admin capability', async () => {
    const state = harness()

    await state.bootstrap.initialize({ name: 'appdata', type: 'document' })

    expect(state.names).toEqual(['appdata'])
    expect(Object.keys(state.bootstrap)).toEqual(['initialize'])
    expect(state.bootstrap).not.toHaveProperty('database')
    expect(state.bootstrap).not.toHaveProperty('system')
    expect(state.bootstrap).not.toHaveProperty('session')
    expect(state.bootstrap).not.toHaveProperty('adapter')
    expect(state.bootstrap).not.toHaveProperty('client')
  })

  test('propagates package failures unchanged for service cleanup', async () => {
    const failure = new DatabaseException('metadata initialization failed')
    const state = harness(async () => {
      throw failure
    })

    const initialization = state.bootstrap.initialize({
      name: 'appdata',
      type: 'document',
    })

    await expect(initialization).rejects.toBe(failure)
  })

  test.each(['managed', 'unmanaged'] as const)(
    'does not initialize metadata for %s schemas',
    async (type) => {
      const state = harness()

      await state.bootstrap.initialize({ name: 'appdata', type })

      expect(state.names).toEqual([])
    },
  )
})

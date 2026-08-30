import type { Database } from '@nuvix/db'

export type DocumentSchemaAdmin = Pick<Database, 'create'>

export interface DocumentSchemaInput {
  readonly name: string
  readonly type: 'document' | 'managed' | 'unmanaged'
}

export interface DocumentSchemaBootstrap {
  initialize(input: DocumentSchemaInput): Promise<void>
}

/**
 * Narrows the @nuvix/db admin plane to document initialization.
 * Database.create(name) creates the schema when needed and seeds its metadata collection.
 */
export function createDocumentSchemaBootstrap(admin: DocumentSchemaAdmin): DocumentSchemaBootstrap {
  return Object.freeze({
    async initialize(input: DocumentSchemaInput): Promise<void> {
      if (input.type !== 'document') return
      await admin.create(input.name)
    },
  })
}

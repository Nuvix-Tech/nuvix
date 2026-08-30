import type { Database } from '@nuvix/db'

export type DocumentSchemaAdmin = Pick<Database, 'create'>

export interface DocumentSchemaAdminFactory {
  /** Returns an isolated admin whose adapter is already bound to this schema. */
  forSchema(name: string): DocumentSchemaAdmin
}

export interface DocumentSchemaInput {
  readonly name: string
  readonly type: 'document' | 'managed' | 'unmanaged'
}

export interface DocumentSchemaBootstrap {
  initialize(input: DocumentSchemaInput): Promise<void>
}

/**
 * Narrows the @nuvix/db admin plane to document initialization. The factory must
 * bind a fresh admin to `name`: Database.create(name) creates the schema when
 * needed, then creates the metadata collection in the adapter's selected schema.
 */
export function createDocumentSchemaBootstrap(
  admins: DocumentSchemaAdminFactory,
): DocumentSchemaBootstrap {
  return Object.freeze({
    async initialize(input: DocumentSchemaInput): Promise<void> {
      if (input.type !== 'document') return
      await admins.forSchema(input.name).create(input.name)
    },
  })
}

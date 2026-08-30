import { translatePackageError } from '../infrastructure/package-errors'
import { AppError, ConflictError, NotFoundError } from '../shared/errors'
import type { SchemaCatalog, SchemaRecord, SchemaType } from './catalog'
import type { DocumentSchemaBootstrap } from './document-schema'

export interface SchemaList {
  readonly data: readonly SchemaRecord[]
  readonly meta: {
    readonly total: number
  }
}

export interface CreateSchemaInput {
  readonly name: string
  readonly description?: string | null
  readonly type: SchemaType
}

export interface SchemaServiceDependencies {
  readonly catalog: SchemaCatalog
  readonly bootstrap: DocumentSchemaBootstrap
}

function failure(error: unknown, name: string): AppError {
  if (error instanceof AppError) return error
  const translated = translatePackageError(error, { operation: name })
  if (translated.status === 500) return translated

  return new AppError(500, {
    type: '/errors/internal',
    detail: `Unable to ${name}`,
  })
}

async function operation<Result>(name: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run()
  } catch (error) {
    throw failure(error, name)
  }
}

function missing(): NotFoundError {
  return new NotFoundError('Schema', {
    code: 'schema_not_found',
    messageKey: 'errors.database.schemaNotFound',
  })
}

function duplicate(): ConflictError {
  return new ConflictError('Schema already exists', {
    code: 'schema_already_exists',
    messageKey: 'errors.database.schemaExists',
  })
}

async function rollback(catalog: SchemaCatalog, name: string): Promise<void> {
  try {
    await catalog.remove(name)
  } catch {
    // Cleanup is best-effort; it must never replace the bootstrap failure.
  }
}

/** Creates the schema use-case boundary from catalog and document-admin capabilities. */
export function createSchemaService(dependencies: SchemaServiceDependencies) {
  const find = (name: string) => operation('get schema', () => dependencies.catalog.get(name))

  const get = async (name: string): Promise<SchemaRecord> => {
    const schema = await find(name)
    if (!schema) throw missing()
    return schema
  }

  return Object.freeze({
    async list(type?: SchemaType): Promise<SchemaList> {
      const schemas = await operation('list schemas', () => dependencies.catalog.list(type))
      return { data: [...schemas], meta: { total: schemas.length } }
    },

    get,

    async create(input: CreateSchemaInput): Promise<SchemaRecord> {
      if (await find(input.name)) throw duplicate()

      const normalized = {
        name: input.name,
        description: input.description ?? null,
        type: input.type,
      }
      await operation('create schema', () => dependencies.catalog.create(normalized))

      if (normalized.type === 'document') {
        try {
          await dependencies.bootstrap.initialize({
            name: normalized.name,
            type: normalized.type,
          })
        } catch (error) {
          await rollback(dependencies.catalog, normalized.name)
          throw failure(error, 'initialize document schema')
        }
      }

      return get(normalized.name)
    },

    async update(name: string, description?: string | null): Promise<SchemaRecord> {
      const schema = await operation('update schema', () =>
        dependencies.catalog.update(name, description ?? null),
      )
      if (!schema) throw missing()
      return schema
    },

    async remove(name: string): Promise<void> {
      await get(name)
      await operation('delete schema', () => dependencies.catalog.remove(name))
    },
  })
}

export type SchemaService = ReturnType<typeof createSchemaService>

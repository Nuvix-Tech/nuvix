import type { Database as PostgresDatabase } from '@nuvix/pg'

export type SchemaType = 'document' | 'managed' | 'unmanaged'

export interface SchemaRecord {
  readonly name: string
  readonly description: string | null
  readonly type: SchemaType
}

export interface SchemaCreateInput {
  readonly name: string
  readonly description: string | null
  readonly type: SchemaType
}

export interface SchemaCatalog {
  list(type?: SchemaType): Promise<readonly SchemaRecord[]>
  get(name: string): Promise<SchemaRecord | undefined>
  create(input: SchemaCreateInput): Promise<void>
  update(name: string, description: string | null): Promise<SchemaRecord | undefined>
  remove(name: string): Promise<void>
}

export type SchemaCatalogDatabase = Pick<PostgresDatabase, 'table' | 'raw'>

const RESERVED_SCHEMA_NAMES = Object.freeze(['core', 'system', 'internal'] as const)
const CREATE_SCHEMA_SQL = 'select system.create_schema(?, ?, ?)'
const DROP_SCHEMA_SQL = 'drop schema if exists ?? cascade'

function schemaType(value: unknown): value is SchemaType {
  return value === 'document' || value === 'managed' || value === 'unmanaged'
}

function schema(row: Readonly<Record<string, unknown>>): SchemaRecord {
  if (
    typeof row.name !== 'string' ||
    (row.description !== null && typeof row.description !== 'string') ||
    !schemaType(row.type)
  ) {
    throw new TypeError('Schema catalog returned an invalid row')
  }

  return Object.freeze({
    name: row.name,
    description: row.description,
    type: row.type,
  })
}

/** Narrows the tenant PostgreSQL facade to schema-registry operations only. */
export function createSchemaCatalog(database: SchemaCatalogDatabase): SchemaCatalog {
  return Object.freeze({
    async list(type?: SchemaType): Promise<readonly SchemaRecord[]> {
      const base = database
        .table('schemas')
        .withSchema('system')
        .select('name', 'description', 'type')
        .whereNotIn('name', RESERVED_SCHEMA_NAMES)
      const query = type === undefined ? base : base.where('type', type)
      const rows = await query.execute()

      return Object.freeze(rows.map(schema))
    },

    async get(name: string): Promise<SchemaRecord | undefined> {
      const row = await database
        .table('schemas')
        .withSchema('system')
        .select('name', 'description', 'type')
        .where('name', name)
        .first()
        .execute()

      return row === undefined ? undefined : schema(row)
    },

    async create(input: SchemaCreateInput): Promise<void> {
      await database
        .raw<void>(CREATE_SCHEMA_SQL, [input.name, input.type, input.description])
        .execute()
    },

    async update(name: string, description: string | null): Promise<SchemaRecord | undefined> {
      const rows = await database
        .table('schemas')
        .withSchema('system')
        .where('name', name)
        .update({ description })
        .returning('name', 'description', 'type')
        .execute()
      const row = rows[0]

      return row === undefined ? undefined : schema(row)
    },

    async remove(name: string): Promise<void> {
      await database.raw<void>(DROP_SCHEMA_SQL, [name]).execute()
    },
  })
}

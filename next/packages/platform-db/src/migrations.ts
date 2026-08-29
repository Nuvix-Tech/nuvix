const MIGRATION_ID_PATTERN = /^\d{4}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

export interface Migration {
  readonly id: string
  readonly sql: string
}

export class MigrationCatalogError extends Error {
  override readonly name = 'MigrationCatalogError'
}

function migration(value: unknown): Migration {
  if (typeof value !== 'object' || value === null) {
    throw new MigrationCatalogError('Migration definition must be an object')
  }

  if (!('id' in value) || typeof value.id !== 'string' || !MIGRATION_ID_PATTERN.test(value.id)) {
    throw new MigrationCatalogError('Migration id must use the 0000_lowercase_name format')
  }

  if (!('sql' in value) || typeof value.sql !== 'string' || value.sql.trim().length === 0) {
    throw new MigrationCatalogError('Migration SQL must be a non-empty string')
  }

  return Object.freeze({ id: value.id, sql: value.sql })
}

export function createMigrationCatalog(definitions: unknown): readonly Migration[] {
  if (!Array.isArray(definitions)) {
    throw new MigrationCatalogError('Migration catalog must be an array')
  }

  const migrations = definitions.map(migration)
  const identities = new Set(migrations.map((definition) => definition.id))

  if (identities.size !== migrations.length) {
    throw new MigrationCatalogError('Migration ids must be unique')
  }

  return Object.freeze(
    migrations.toSorted((left, right) => {
      if (left.id === right.id) return 0
      return left.id < right.id ? -1 : 1
    }),
  )
}

const initialSql = await Bun.file(
  new URL('../migrations/0001_platform_projects.sql', import.meta.url),
).text()
const credentialBindingsSql = await Bun.file(
  new URL('../migrations/0002_project_credential_bindings.sql', import.meta.url),
).text()

export const migrations = createMigrationCatalog([
  { id: '0001_platform_projects', sql: initialSql },
  { id: '0002_project_credential_bindings', sql: credentialBindingsSql },
])

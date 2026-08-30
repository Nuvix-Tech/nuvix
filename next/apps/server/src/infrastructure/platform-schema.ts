import { AttributeType, type Database, Doc, IndexType } from '@nuvix/db'
import {
  PLATFORM_PERSISTENCE_MODEL,
  type PlatformPersistenceModel,
} from './platform-persistence-model'

export type PlatformCollectionDefinition = Parameters<Database['createCollection']>[0]

export type PlatformSchemaDatabase = Pick<Database, 'createCollection' | 'exists' | 'getAdapter'>

/** Common adapter contract needed by the portable platform schema. */
export interface PlatformSchemaCapabilities {
  readonly $limitForAttributes: number
  readonly $limitForIndexes: number
  readonly $supportForIndex: boolean
  readonly $supportForUniqueIndex: boolean
}

const stringAttribute = (id: string, size: number, required = true) =>
  new Doc({
    $id: id,
    key: id,
    type: AttributeType.String,
    size,
    required,
  })

const booleanAttribute = (id: string) =>
  new Doc({
    $id: id,
    key: id,
    type: AttributeType.Boolean,
    required: true,
    default: true,
  })

const index = (id: string, type: IndexType, attributes: readonly string[]) =>
  new Doc({
    $id: id,
    key: id,
    type,
    attributes: [...attributes],
  })

/** Builds the portable schema without inspecting a concrete adapter type. */
export function createPlatformCollectionDefinitions(
  model: PlatformPersistenceModel = PLATFORM_PERSISTENCE_MODEL,
): readonly PlatformCollectionDefinition[] {
  const { collections, fields } = model

  return [
    {
      id: collections.projects,
      attributes: [
        stringAttribute(fields.projects.publicId, 255),
        booleanAttribute(fields.projects.enabled),
      ],
      indexes: [index('public_id_unique', IndexType.Unique, [fields.projects.publicId])],
      permissions: [],
      documentSecurity: false,
    },
    {
      id: collections.tenantTargets,
      attributes: [
        stringAttribute(fields.tenantTargets.projectId, 255),
        new Doc({
          $id: fields.tenantTargets.target,
          key: fields.tenantTargets.target,
          type: AttributeType.String,
          size: 65_535,
          required: true,
          filters: ['json', 'encrypt'],
        }),
      ],
      indexes: [index('project_id_unique', IndexType.Unique, [fields.tenantTargets.projectId])],
      permissions: [],
      documentSecurity: false,
    },
  ]
}

/** Rejects unsupported schema requirements before any persistence call occurs. */
export function assertPlatformSchemaCapabilities(
  capabilities: PlatformSchemaCapabilities,
  definitions: readonly PlatformCollectionDefinition[],
): void {
  if (!capabilities.$supportForIndex || !capabilities.$supportForUniqueIndex) {
    throw new Error('Platform database does not support the portable index contract')
  }

  for (const definition of definitions) {
    const attributes = definition.attributes?.length ?? 0
    const indexes = definition.indexes?.length ?? 0

    if (capabilities.$limitForAttributes > 0 && attributes > capabilities.$limitForAttributes) {
      throw new Error('Platform collection exceeds the adapter attribute limit')
    }
    if (capabilities.$limitForIndexes > 0 && indexes > capabilities.$limitForIndexes) {
      throw new Error('Platform collection exceeds the adapter index limit')
    }
  }
}

/** Explicit setup operation; process/API startup must not invoke it implicitly. */
export async function setupPlatformSchema(
  database: PlatformSchemaDatabase,
  model: PlatformPersistenceModel = PLATFORM_PERSISTENCE_MODEL,
): Promise<void> {
  const definitions = createPlatformCollectionDefinitions(model)
  assertPlatformSchemaCapabilities(database.getAdapter(), definitions)

  for (const definition of definitions) {
    if (!(await database.exists(undefined, definition.id))) {
      await database.createCollection(definition)
    }
  }
}

import { AttributeType, type Database, Doc, Permission, Role } from '@nuvix/db'
import { API_SCOPE_ROLE_PREFIX } from '../context/database-roles'
import { TEAM_MODEL, type TeamModel } from './model'

export type TeamCollectionDefinition = Parameters<Database['createCollection']>[0]
export type TeamSchemaDatabase = Pick<Database, 'createCollection' | 'exists'>

export function createTeamCollectionDefinition(
  model: TeamModel = TEAM_MODEL,
): TeamCollectionDefinition {
  return {
    id: model.collection,
    attributes: [
      new Doc({
        $id: model.fields.name,
        key: model.fields.name,
        type: AttributeType.String,
        size: 128,
        required: true,
      }),
      new Doc({
        $id: model.fields.total,
        key: model.fields.total,
        type: AttributeType.Integer,
        required: true,
        default: 0,
      }),
      new Doc({
        $id: model.fields.prefs,
        key: model.fields.prefs,
        type: AttributeType.Json,
        required: true,
        default: {},
      }),
    ],
    indexes: [],
    permissions: [
      Permission.create(Role.users()),
      Permission.create(Role.label(`${API_SCOPE_ROLE_PREFIX}teams.write`)),
    ],
    documentSecurity: true,
  }
}

/** Explicit provisioning operation; API startup never mutates tenant schemas. */
export async function setupTeamSchema(
  database: TeamSchemaDatabase,
  model: TeamModel = TEAM_MODEL,
): Promise<void> {
  if (!(await database.exists(undefined, model.collection))) {
    await database.createCollection(createTeamCollectionDefinition(model))
  }
}

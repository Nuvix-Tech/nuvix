import type { PlatformSqlQuery } from './pool'

export type ProjectCredential =
  | {
      readonly type: 'session'
      readonly sessionId: string
      readonly userId: string
    }
  | {
      readonly type: 'jwt'
      readonly userId: string
      readonly sessionId?: string
    }
  | {
      readonly type: 'apiKey'
      readonly keyId: string
      readonly mode: 'admin' | 'console'
    }

export interface PublicProject {
  readonly id: string
}

export interface ProjectRepository {
  resolve(publicProjectId: string): Promise<PublicProject | null>
  verifyBinding(publicProjectId: string, credential: ProjectCredential): Promise<boolean>
}

interface FoundRow {
  readonly found: boolean
}

interface BoundRow {
  readonly bound: boolean
}

interface BindingIdentity {
  readonly type: 'session' | 'user' | 'api_key'
  readonly id: string
  readonly subjectId: string | null
  readonly mode: 'admin' | 'console' | null
}

const failure = (): Error => new Error('Platform project repository query failed')

function normalized(publicProjectId: string): string {
  if (
    publicProjectId.length < 1 ||
    publicProjectId.length > 128 ||
    publicProjectId.trim() !== publicProjectId
  ) {
    throw new TypeError('Project identifier must be normalized')
  }

  return publicProjectId
}

async function query<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation()
  } catch {
    throw failure()
  }
}

function identity(credential: ProjectCredential): BindingIdentity {
  if (credential.type === 'session') {
    return {
      type: 'session',
      id: credential.sessionId,
      subjectId: credential.userId,
      mode: null,
    }
  }

  if (credential.type === 'jwt') {
    return { type: 'user', id: credential.userId, subjectId: null, mode: null }
  }

  return {
    type: 'api_key',
    id: credential.keyId,
    subjectId: null,
    mode: credential.mode,
  }
}

/** Creates a read-only project registry capability over process-owned platform SQL. */
export function createProjectRepository(sql: PlatformSqlQuery): ProjectRepository {
  const resolve = async (input: string): Promise<PublicProject | null> => {
    const publicProjectId = normalized(input)
    const rows = await query(
      () => sql.query<readonly FoundRow[]>`
      SELECT TRUE AS found
      FROM projects
      WHERE public_id = ${publicProjectId} AND enabled = ${true}
      LIMIT 1
    `,
    )

    return rows[0]?.found === true ? { id: publicProjectId } : null
  }

  const verifyBinding = async (input: string, credential: ProjectCredential): Promise<boolean> => {
    const publicProjectId = normalized(input)
    const binding = identity(credential)

    const rows = await query(
      () => sql.query<readonly BoundRow[]>`
      SELECT TRUE AS bound
      FROM projects AS project
      INNER JOIN project_credential_bindings AS binding ON binding.project_id = project.id
      WHERE project.public_id = ${publicProjectId}
        AND project.enabled = ${true}
        AND binding.credential_type = ${binding.type}
        AND binding.credential_id = ${binding.id}
        AND binding.subject_id IS NOT DISTINCT FROM ${binding.subjectId}
        AND binding.api_key_mode IS NOT DISTINCT FROM ${binding.mode}
        AND binding.enabled = ${true}
        AND binding.revoked_at IS NULL
        AND (binding.expires_at IS NULL OR binding.expires_at > CURRENT_TIMESTAMP)
      LIMIT 1
    `,
    )
    return rows[0]?.bound === true
  }

  return { resolve, verifyBinding }
}

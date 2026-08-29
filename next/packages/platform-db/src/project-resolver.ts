import type { ProjectCredential, ProjectRepository, PublicProject } from './projects'

export type ProjectResolverAuth = { readonly type: 'guest' } | ProjectCredential

export type ProjectResolution =
  | { readonly type: 'found'; readonly project: PublicProject }
  | { readonly type: 'not-found' }
  | { readonly type: 'forbidden' }

export interface ProjectResolver {
  resolve(publicProjectId: string, auth: ProjectResolverAuth): Promise<ProjectResolution>
}

const failure = (): Error => new Error('Platform project resolution failed')

function credential(auth: Exclude<ProjectResolverAuth, { type: 'guest' }>): ProjectCredential {
  if (auth.type === 'jwt') return { type: 'jwt', userId: auth.userId }

  if (auth.type === 'session') {
    return { type: 'session', sessionId: auth.sessionId, userId: auth.userId }
  }

  return { type: 'apiKey', keyId: auth.keyId, mode: auth.mode }
}

async function query<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation()
  } catch {
    throw failure()
  }
}

/** Composes safe project lookup with independent credential binding verification. */
export function createProjectResolver(repository: ProjectRepository): ProjectResolver {
  const resolve = async (
    publicProjectId: string,
    auth: ProjectResolverAuth,
  ): Promise<ProjectResolution> => {
    const project = await query(() => repository.resolve(publicProjectId))
    if (!project) return { type: 'not-found' }

    const safeProject = { id: project.id }
    if (auth.type === 'guest') return { type: 'found', project: safeProject }

    const bound = await query(() => repository.verifyBinding(publicProjectId, credential(auth)))
    if (!bound) return { type: 'forbidden' }

    return { type: 'found', project: safeProject }
  }

  return { resolve }
}

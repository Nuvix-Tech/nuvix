import { HEADERS } from '../shared/constants'
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../shared/errors'
import type { ProjectContext, ProjectResolver } from './project'
import { type PublishableKeyEnvironment, parsePublishableKey } from './publishable-key'

export interface ProjectLocator {
  resolve(headers: Headers): Promise<ProjectContext>
}

function unavailable(): ServiceUnavailableError {
  return new ServiceUnavailableError('Project is temporarily unavailable', {
    code: 'project_unavailable',
  })
}

/** Resolves project context only. Authentication deliberately happens later. */
export function createProjectLocator(
  projects: Pick<ProjectResolver, 'resolve'>,
  environment: PublishableKeyEnvironment,
): ProjectLocator {
  return Object.freeze({
    async resolve(headers: Headers): Promise<ProjectContext> {
      const raw = headers.get(HEADERS.publishableKey)
      if (raw === null) {
        throw new BadRequestError('Publishable key is required', {
          code: 'publishable_key_required',
        })
      }

      const locator = parsePublishableKey(raw, environment)
      if (!locator) {
        throw new BadRequestError('Publishable key is invalid', {
          code: 'publishable_key_invalid',
        })
      }

      const project = await projects.resolve(locator.projectId).catch(() => {
        throw unavailable()
      })
      if (!project?.enabled) {
        throw new NotFoundError('Project', { code: 'project_not_found' })
      }

      return Object.freeze({ id: project.id, enabled: true })
    },
  })
}

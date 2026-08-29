import { describe, expect, test } from 'bun:test'
import {
  createResolverBackedTenantDatabaseResource,
  type PlatformConnectionMetadataResolver,
} from '../src/infrastructure/platform-connection-metadata'

interface FakeResource {
  readonly connectionString: string
}

function harness(metadata: string | null) {
  const resolvedProjects: string[] = []
  const constructedConnections: string[] = []
  const resolver: PlatformConnectionMetadataResolver = {
    resolve: async (projectId) => {
      resolvedProjects.push(projectId)
      return metadata === null ? null : { connectionString: metadata }
    },
  }
  const createResource = (connectionString: string): FakeResource => {
    constructedConnections.push(connectionString)
    return { connectionString }
  }

  return { constructedConnections, createResource, resolvedProjects, resolver }
}

describe('platform connection metadata', () => {
  test('looks up the exact project and forwards the exact resolved connection', async () => {
    // Arrange
    const connectionString = 'postgresql://tenant.example.test/exact'
    const state = harness(connectionString)

    // Act
    const resource = await createResolverBackedTenantDatabaseResource(
      'project-123',
      state.resolver,
      state.createResource,
    )

    // Assert
    expect({
      constructedConnections: state.constructedConnections,
      resource,
      resolvedProjects: state.resolvedProjects,
    }).toEqual({
      constructedConnections: [connectionString],
      resource: { connectionString },
      resolvedProjects: ['project-123'],
    })
  })

  test('reports missing metadata without constructing a resource', async () => {
    // Arrange
    const state = harness(null)

    // Act
    const creation = createResolverBackedTenantDatabaseResource(
      'project-missing',
      state.resolver,
      state.createResource,
    )

    // Assert
    await expect(creation).rejects.toThrow('connection metadata was not found')
    expect(state.constructedConnections).toEqual([])
  })

  test.each([
    '',
    '   ',
    'project-123',
    'https://tenant.example.test/database',
    ' postgresql://user:secret@tenant.example.test/database ',
  ])(
    'rejects invalid metadata without exposing it or constructing a resource',
    async (metadata) => {
      // Arrange
      const state = harness(metadata)

      // Act
      const failure = await createResolverBackedTenantDatabaseResource(
        'project-invalid',
        state.resolver,
        state.createResource,
      ).catch((error: unknown) => error)

      // Assert
      expect(failure).toBeInstanceOf(TypeError)
      expect((failure as Error).message).toBe('Tenant database connection metadata is invalid')
      expect((failure as Error).message).not.toContain('secret')
      expect(state.constructedConnections).toEqual([])
    },
  )

  test('translates resolver failures without disclosing credentials or constructing a resource', async () => {
    // Arrange
    const credential = 'resolver-secret-password'
    const resolutionError = new Error(
      `platform lookup failed for postgresql://admin:${credential}@platform.example.test/system`,
    )
    const constructedConnections: string[] = []
    const resolver: PlatformConnectionMetadataResolver = {
      resolve: async () => {
        throw resolutionError
      },
    }

    // Act
    const creation = createResolverBackedTenantDatabaseResource(
      'project-failed',
      resolver,
      (connectionString): FakeResource => {
        constructedConnections.push(connectionString)
        return { connectionString }
      },
    )

    // Assert
    const failure = await creation.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBe(resolutionError)
    expect((failure as Error).message).toBe('Tenant database connection metadata resolution failed')
    expect(String(failure)).not.toContain(credential)
    expect('cause' in (failure as Error)).toBe(false)
    expect(constructedConnections).toEqual([])
  })

  test.each(['', ' project-123', 'project-123 '])(
    'rejects an unnormalized project before metadata resolution',
    async (projectId) => {
      // Arrange
      const state = harness('postgresql://tenant.example.test/unused')

      // Act
      const creation = createResolverBackedTenantDatabaseResource(
        projectId,
        state.resolver,
        state.createResource,
      )

      // Assert
      await expect(creation).rejects.toThrow('projectId must be a normalized, non-empty value')
      expect(state.resolvedProjects).toEqual([])
      expect(state.constructedConnections).toEqual([])
    },
  )
})

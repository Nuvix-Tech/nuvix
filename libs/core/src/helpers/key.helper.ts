import { JwtService } from '@nestjs/jwt'
import { Doc, RoleName } from '@nuvix/db'
import { ApiKey } from '@nuvix/utils'
import { KeysDoc, ProjectsDoc } from '@nuvix/utils/types'
import { roles } from '../config/roles'
import { UserRole } from './auth.helper'

interface JWTPayload {
  name?: string
  projectId?: string
  disabledMetrics?: string[]
  hostnameOverride?: boolean
  bannerDisabled?: boolean
  projectCheckDisabled?: boolean
  previewAuthDisabled?: boolean
  deploymentStatusIgnored?: boolean
  scopes?: string[]
}

export class Key {
  private static jwtService: JwtService
  constructor(
    protected projectId: string,
    protected type: string,
    protected role: string,
    protected scopes: string[],
    protected name: string,
    protected readonly key: string,
    protected readonly expired: boolean = false,
  ) {}

  public getProjectId(): string {
    return this.projectId
  }

  public getType(): string {
    return this.type
  }

  public getRole(): string {
    return this.role
  }

  public getScopes(): string[] {
    return this.scopes
  }

  public getName(): string {
    return this.name
  }

  public getKey(): string {
    return this.key
  }

  public isExpired(): boolean {
    return this.expired
  }

  public static setJwtService(jwtService: JwtService) {
    Key.jwtService = jwtService
  }

  /**
   * Decode the given secret key into a Key object, containing the project ID, type, role, scopes, and name.
   * Can be a stored API key or a dynamic key (JWT).
   */
  public static async decode(project: ProjectsDoc, key: string): Promise<Key> {
    let type: string
    let secret: string

    if (
      key.startsWith(`${ApiKey.DYNAMIC}_`) ||
      key.startsWith(`${ApiKey.STANDARD}_`)
    ) {
      const firstSplitIndex = key.indexOf('_')
      type = key.slice(0, firstSplitIndex)
      secret = key.slice(firstSplitIndex + 1)
    } else {
      type = ApiKey.STANDARD
      secret = key
    }

    const role = UserRole.APPS
    let scopes = roles[role]?.scopes ?? []
    let expired = false

    const guestKey = new Key(
      project.getId(),
      type,
      RoleName.GUESTS,
      roles[RoleName.GUESTS]?.scopes ?? [],
      'UNKNOWN',
      key,
    )

    switch (type) {
      case ApiKey.DYNAMIC: {
        if (!Key.jwtService) {
          throw new Error('JWT Service is not set for Key decoding')
        }

        let payload: JWTPayload = {}
        try {
          payload = (await Key.jwtService.verifyAsync(secret)) as JWTPayload
        } catch (_error) {
          expired = true
        }

        const name = payload.name ?? 'Dynamic Key'
        const projectId = payload.projectId ?? ''
        const projectCheckDisabled = payload.projectCheckDisabled ?? false
        scopes = [...(payload.scopes ?? []), ...scopes]

        if (!projectCheckDisabled && projectId !== project.getId()) {
          return guestKey
        }

        return new Key(projectId, type, role, scopes, name, key, expired)
      }

      case ApiKey.STANDARD: {
        const keyDoc = project.findWhere(
          'keys',
          (item: Doc) => item.get('secret') === key,
        ) as KeysDoc | null

        if (!keyDoc) {
          return guestKey
        }

        const expire = keyDoc.get('expire')
        if (
          expire &&
          new Date(expire as string).getTime() < Date.now()
        ) {
          expired = true
        }

        const keyName = keyDoc.get('name', 'UNKNOWN')
        scopes = [...keyDoc.get('scopes', []), ...scopes]

        return new Key(
          project.getId(),
          type,
          role,
          scopes,
          keyName,
          key,
          expired,
        )
      }

      default:
        return guestKey
    }
  }
}

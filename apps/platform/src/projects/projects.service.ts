import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { CoreService } from '@nuvix/core'
import {
  AuthMethod,
  apis,
  authMethods,
  defaultAuthConfig,
  defaultSmtpConfig,
  type OAuthProviderType,
  oAuthProviders,
  services,
} from '@nuvix/core/config'
import { Exception } from '@nuvix/core/extend/exception'
import { Auth } from '@nuvix/core/helpers'
import {
  Database,
  Doc,
  DuplicateException,
  ID,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import { ApiKey, configuration } from '@nuvix/utils'
import { setupDatabase } from '@nuvix/utils/database'
import type { Projects } from '@nuvix/utils/types'
import { CreateJwtDTO } from './DTO/create-jwt.dto'
import { CreateProjectDTO } from './DTO/create-project.dto'
import { oAuth2DTO } from './DTO/oauth2.dto'
import { ProjectApiStatusDTO } from './DTO/project-api.dto'
import { UpdateProjectServiceDTO } from './DTO/project-service.dto'
import { SmtpTestsDTO, UpdateSmtpDTO } from './DTO/smtp.dto'
import {
  UpdateProjectDTO,
  UpdateProjectTeamDTO,
} from './DTO/update-project.dto'

@Injectable()
export class ProjectService {
  private readonly db: Database

  constructor(
    private coreService: CoreService,
    private readonly jwtService: JwtService,
  ) {
    this.db = this.coreService.getInternalDatabase()
  }

  /**
   * Create a new project.
   */
  async create({
    projectId: _projectId,
    teamId,
    password,
    name,
    ...rest
  }: CreateProjectDTO): Promise<Doc<Projects>> {
    const projectId = _projectId === 'unique()' ? ID.unique() : _projectId

    try {
      const org = await this.db.getDocument('teams', teamId)

      if (org.empty()) {
        throw new Exception(Exception.TEAM_NOT_FOUND, 'Organization not found.')
      }

      if (projectId === 'console') {
        throw new Exception(
          Exception.PROJECT_RESERVED_PROJECT,
          '`console` is a reserved project.',
        )
      }

      const auths = loadAuthConfig(authMethods)
      const defaultoAuthProviders: OAuthProviderType[] = []
      const defaultServices: Record<string, boolean> = {}

      Object.entries(oAuthProviders).forEach(([key, value]) => {
        if (value.enabled) {
          defaultoAuthProviders.push({
            key: key,
            name: value.name,
            appId: undefined,
            secret: undefined,
            enabled: false,
          })
        }
      })

      Object.values(services).forEach(value => {
        if (value.optional) {
          defaultServices[value.key] = true
        }
      })

      let project = new Doc<Projects>({
        ...rest,
        $id: projectId,
        $permissions: [
          Permission.read(Role.team(ID.custom(teamId))),
          Permission.update(Role.team(ID.custom(teamId), 'owner')),
          Permission.update(Role.team(ID.custom(teamId), 'developer')),
          Permission.delete(Role.team(ID.custom(teamId), 'owner')),
          Permission.delete(Role.team(ID.custom(teamId), 'developer')),
        ],
        teamId: org.getId(),
        teamInternalId: org.getSequence(),
        name: name,
        oAuthProviders: defaultoAuthProviders as any,
        smtp: defaultSmtpConfig as any,
        auths: auths,
        services: defaultServices,
        accessedAt: new Date(),
        environment: '',
        database: {
          postgres: {
            password,
          },
          pool: {
            password,
          },
        } as any,
        enabled: true,
        status: 'pending',
        metadata: {
          allowedSchemas: ['public'],
        },
      })

      project = await this.db.createDocument('projects', project)
      await setupDatabase({
        coreService: this.coreService,
        projectId: project.getId(),
      })

      return project
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.PROJECT_ALREADY_EXISTS)
      }
      throw error
    }
  }

  async findAll(queries: Query[], search?: string) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const filterQueries = Query.groupByType(queries).filters
    return {
      data: await this.db.find('projects', queries),
      total: await this.db.count(
        'projects',
        filterQueries,
        configuration.limits.maxCount,
      ),
    }
  }

  async findOne(id: string) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    return project
  }

  async update(id: string, updateProjectDTO: UpdateProjectDTO) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    project
      .update('name', updateProjectDTO.name)
      .update('description', updateProjectDTO.description)
      .update('logo', updateProjectDTO.logo)
      .update('url', updateProjectDTO.url)
      .update(
        'search',
        [id, updateProjectDTO.name ?? project.get('name')].join(' '),
      )

    project = await this.db.updateDocument('projects', project.getId(), project)

    return project
  }

  /**
   * Delete a project.
   */
  async remove(id: string) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    if (!(await this.db.deleteDocument('projects', id))) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed to remove project from DB',
      )
    }

    return
  }

  /**
   * Update organization of a project.
   */
  async updateProjectOrganization(id: string, input: UpdateProjectTeamDTO) {
    let project = await this.db.getDocument('projects', id)
    const team = await this.db.getDocument('teams', input.teamId)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    if (team.empty()) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    const permissions = [
      Permission.read(Role.team(ID.custom(input.teamId))),
      Permission.update(Role.team(ID.custom(input.teamId), 'owner')),
      Permission.update(Role.team(ID.custom(input.teamId), 'developer')),
      Permission.delete(Role.team(ID.custom(input.teamId), 'owner')),
      Permission.delete(Role.team(ID.custom(input.teamId), 'developer')),
    ]

    project
      .set('teamId', input.teamId)
      .set('teamInternalId', team.getSequence())
      .set('$permissions', permissions)

    project = await this.db.updateDocument('projects', project.getId(), project)

    const installations = await this.db.find('installations', [
      Query.equal('projectInternalId', [project.getSequence()]),
    ])
    for (const installation of installations) {
      installation.get('$permissions', permissions)
      await this.db.updateDocument(
        'installations',
        installation.getId(),
        installation,
      )
    }

    const repositories = await this.db.find('repositories', [
      Query.equal('projectInternalId', [project.getSequence()]),
    ])
    for (const repository of repositories) {
      repository.get('$permissions', permissions)
      await this.db.updateDocument(
        'repositories',
        repository.getId(),
        repository,
      )
    }

    const vcsComments = await this.db.find('vcsComments', [
      Query.equal('projectInternalId', [project.getSequence()]),
    ])
    for (const vcsComment of vcsComments) {
      vcsComment.get('$permissions', permissions)
      await this.db.updateDocument(
        'vcsComments',
        vcsComment.getId(),
        vcsComment,
      )
    }

    return project
  }

  /**
   * Create A JWT token.
   */
  async createJwt(id: string, input: CreateJwtDTO) {
    const project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const jwt = await this.jwtService.signAsync(
      { projectId: project.getId(), scopes: input.scopes },
      { expiresIn: input.duration },
    )

    return {
      jwt: `${ApiKey.DYNAMIC}_${jwt}`,
    }
  }

  /**
   * Update service status of a project.
   */
  async updateServiceStatus(
    id: string,
    { status, service }: UpdateProjectServiceDTO,
  ) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const services = project.get('services', {})
    services[service] = status

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('services', services),
    )

    return project
  }

  /**
   * Update all services status of a project.
   */
  async updateAllServiceStatus(id: string, status: boolean) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const servicesObj: Record<string, boolean> = {}
    Object.entries(services).forEach(([, value]) => {
      if (value.optional) {
        servicesObj[value.key] = status
      }
    })

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('services', servicesObj),
    )

    return project
  }

  /**
   * Update Apis status of a project.
   */
  async updateApiStatus(id: string, { api, status }: ProjectApiStatusDTO) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const apis = project.get('apis', {})
    apis[api] = status

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('apis', apis),
    )

    return project
  }

  /**
   * Update all Apis status of a project.
   */
  async updateAllApiStatus(id: string, status: boolean) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const apisObj: Record<string, boolean> = {}
    Object.keys(apis).forEach(api => {
      apisObj[api] = status
    })

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('apis', apisObj),
    )

    return project
  }

  /**
   * Update OAuth2 of a project.
   */
  async updateOAuth2(
    id: string,
    { provider, appId, secret, enabled }: oAuth2DTO,
  ) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    const providers = project.get('oAuthProviders', []) as OAuthProviderType[]
    const providerIndex = providers.findIndex(p => p.key === provider)

    if (providerIndex === -1) {
      throw new Exception(Exception.PROVIDER_NOT_FOUND)
    }

    if (appId !== undefined) {
      providers[providerIndex]!.appId = appId
    }

    if (secret !== undefined) {
      providers[providerIndex]!.secret = Auth.encrypt(secret)
    }

    if (enabled !== undefined) {
      providers[providerIndex]!.enabled = enabled
    }

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('oAuthProviders', providers),
    )

    return project
  }

  /**
   * Update SMTP of a project.
   */
  async updateSMTP(id: string, input: UpdateSmtpDTO) {
    let project = await this.db.getDocument('projects', id)

    if (project.empty()) {
      throw new Exception(Exception.PROJECT_NOT_FOUND)
    }

    if (input.enabled) {
      if (!input.senderName) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          'Sender name is required when enabling SMTP.',
        )
      }
      if (!input.senderEmail) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          'Sender email is required when enabling SMTP.',
        )
      }
      if (!input.host) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          'Host is required when enabling SMTP.',
        )
      }
      if (!input.port) {
        throw new Exception(
          Exception.GENERAL_ARGUMENT_INVALID,
          'Port is required when enabling SMTP.',
        )
      }
    }

    // TODO: SMTP validation logic

    const smtp = input.enabled
      ? {
          enabled: input.enabled,
          senderName: input.senderName,
          senderEmail: input.senderEmail,
          replyTo: input.replyTo,
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
          secure: input.secure,
        }
      : {
          enabled: false,
        }

    project = await this.db.updateDocument(
      'projects',
      project.getId(),
      project.set('smtp', smtp),
    )

    return project
  }

  /**
   * @todo :- Impliment the function...
   * Test SMTP
   */
  async testSMTP(_id: string, _input: SmtpTestsDTO) {
    throw new Exception(Exception.GENERAL_NOT_IMPLEMENTED)
  }
}

export function loadAuthConfig(authMethods: Record<string, AuthMethod>) {
  const authConfig: Record<string, any> = { ...defaultAuthConfig }

  Object.values(authMethods).forEach(method => {
    if (method.enabled) {
      authConfig[method.key] = true
    }
  })

  return authConfig
}

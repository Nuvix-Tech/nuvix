import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CoreService } from '@nuvix/core'
import { Exception } from '@nuvix/core/extend/exception'
import { ID, RequestContext } from '@nuvix/core/helpers'
import { DeletesQueue } from '@nuvix/core/resolvers'
import {
  Database,
  Doc,
  DuplicateException,
  Permission,
  Query,
  Role,
} from '@nuvix/db'
import { AppEvents } from '@nuvix/utils'
import type { UsersDoc } from '@nuvix/utils/types'
import {
  CreateTeamDTO,
  UpdateTeamDTO,
  UpdateTeamPrefsDTO,
} from './DTO/team.dto'

@Injectable()
export class TeamsService {
  protected readonly db: Database
  constructor(
    private readonly coreService: CoreService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.db = this.coreService.getDatabase()
  }

  /**
   * Find all teams
   */
  async findAll(queries: Query[] = [], search?: string) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const filterQueries = Query.groupByType(queries).filters
    const results = await this.db.find('teams', queries)
    const total = await this.db.count('teams', filterQueries)

    return {
      data: results,
      total: total,
    }
  }

  /**
   * Create a new team
   */
  async create(user: UsersDoc, input: CreateTeamDTO, ctx: RequestContext) {
    const teamId = input.teamId === 'unique()' ? ID.unique() : input.teamId

    const team = await this.db
      .createDocument(
        'teams',
        new Doc({
          $id: teamId,
          $permissions: [
            Permission.read(Role.team(teamId)),
            Permission.update(Role.team(teamId, 'owner')),
            Permission.delete(Role.team(teamId, 'owner')),
          ],
          name: input.name,
          total: ctx.isAPIUser || ctx.isAdminUser ? 0 : 1, // If team is created by API or Admin user, set total to 0, otherwise set to 1 (for the creator)
          prefs: {},
          search: [teamId, input.name].join(' '),
        }),
      )
      .catch(error => {
        if (error instanceof DuplicateException) {
          throw new Exception(Exception.TEAM_ALREADY_EXISTS)
        }
        throw error
      })

    // If team is created by API or Admin user, do not create membership for the creator
    if (!ctx.isAPIUser && !ctx.isAdminUser && !user.empty()) {
      if (!input.roles?.includes('owner')) {
        input.roles?.push('owner')
      }

      const membershipId = ID.unique()
      await this.db.createDocument(
        'memberships',
        new Doc({
          $id: membershipId,
          $permissions: [
            Permission.read(Role.user(user.getId())),
            Permission.read(Role.team(team.getId())),
            Permission.update(Role.user(user.getId())),
            Permission.update(Role.team(team.getId(), 'owner')),
            Permission.delete(Role.user(user.getId())),
            Permission.delete(Role.team(team.getId(), 'owner')),
          ],
          userId: user.getId(),
          userInternalId: user.getSequence(),
          teamId: team.getId(),
          teamInternalId: team.getSequence(),
          roles: input.roles,
          invited: new Date(),
          joined: new Date(),
          confirm: true,
          secret: '',
          search: [membershipId, user.getId()].join(' '),
        }),
      )

      await this.db.purgeCachedDocument('users', user.getId())
    }

    this.eventEmitter.emit(AppEvents.TEAMS_CREATE, {
      teamId: team.getId(),
      payload: {
        data: team,
      },
    })

    return team
  }

  /**
   * Update team
   */
  async update(id: string, input: UpdateTeamDTO) {
    const team = await this.db.getDocument('teams', id)

    if (team.empty()) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    team.set('name', input.name)
    team.set('search', [id, input.name].join(' '))

    const updatedTeam = await this.db.updateDocument(
      'teams',
      team.getId(),
      team,
    )

    this.eventEmitter.emit(AppEvents.TEAMS_UPDATE, {
      teamId: updatedTeam.getId(),
      payload: {
        data: updatedTeam,
      },
    })

    return updatedTeam
  }

  /**
   * Remove team
   */
  async remove(id: string) {
    const team = await this.db.getDocument('teams', id)

    if (team.empty()) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    const teamId = team.getId()

    const deleted = await this.db.deleteDocument('teams', teamId)
    if (!deleted) {
      throw new Exception(
        Exception.GENERAL_SERVER_ERROR,
        'Failed to remove team from DB',
      )
    }

    const deletes = new DeletesQueue(this.coreService)
    await deletes.deleteMemberships(team)

    this.eventEmitter.emit(AppEvents.TEAMS_DELETE, {
      teamId,
    })

    return
  }

  /**
   * Find a team by id
   */
  async findOne(id: string) {
    const team = await this.db.getDocument('teams', id)

    if (team.empty()) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    return team
  }

  /**
   * Get team preferences
   */
  async getPrefs(id: string) {
    const team = await this.db.getDocument('teams', id)

    if (!team) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    return team.get('prefs', {})
  }

  /**
   * Set team preferences
   */
  async setPrefs(id: string, { prefs }: UpdateTeamPrefsDTO) {
    const team = await this.db.getDocument('teams', id)

    if (team.empty()) {
      throw new Exception(Exception.TEAM_NOT_FOUND)
    }

    team.set('prefs', prefs)
    const updatedTeam = await this.db.updateDocument(
      'teams',
      team.getId(),
      team,
    )

    this.eventEmitter.emit(AppEvents.TEAMS_UPDATE_PREFS, {
      teamId: updatedTeam.getId(),
      payload: {
        data: updatedTeam,
      },
    })

    return updatedTeam.get('prefs')
  }
}

import { t } from 'elysia'

export const TeamId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const TeamName = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '.*\\S.*',
})
export const TeamRole = t.String({
  minLength: 1,
  maxLength: 32,
  pattern: '^[\\p{L}\\p{M}\\p{N}._-]+$',
})
export const Preferences = t.Record(t.String(), t.Any())

export const TeamResponse = t.Object({
  $id: TeamId,
  name: TeamName,
  total: t.Integer({ minimum: 0 }),
  prefs: Preferences,
  $createdAt: t.String({ format: 'date-time' }),
  $updatedAt: t.String({ format: 'date-time' }),
})

export const TeamListResponse = t.Object({
  data: t.Array(TeamResponse),
  meta: t.Object({
    total: t.Integer({ minimum: 0 }),
    limit: t.Integer({ minimum: 1, maximum: 100 }),
    offset: t.Integer({ minimum: 0 }),
  }),
})

export const TeamParams = t.Object({ teamId: TeamId })
export const TeamListQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
})
export const CreateTeamBody = t.Object({
  name: TeamName,
  roles: t.Optional(t.Array(TeamRole, { maxItems: 100 })),
})
export const UpdateTeamBody = t.Object({ name: TeamName })
export const UpdateTeamPrefsBody = t.Object({ prefs: Preferences })

import { t } from 'elysia'
import { Preferences } from '../teams/contracts'
import { Email, Name, UserId, UserResponse } from '../users/contracts'

export const SessionId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const Password = t.String({ minLength: 8, maxLength: 256 })

export const CreateAccountBody = t.Object(
  {
    userId: t.Optional(t.Union([UserId, t.Literal('unique()')])),
    email: Email,
    password: Password,
    name: t.Optional(Name),
  },
  { additionalProperties: false },
)

export const CreateEmailSessionBody = t.Object(
  {
    email: Email,
    password: Password,
  },
  { additionalProperties: false },
)

export const SessionResponse = t.Object({
  $id: SessionId,
  userId: UserId,
  token: t.Optional(t.String()),
  expiresAt: t.String({ format: 'date-time' }),
  $createdAt: t.String({ format: 'date-time' }),
  $updatedAt: t.String({ format: 'date-time' }),
})

export const SessionListResponse = t.Object({
  data: t.Array(SessionResponse),
  meta: t.Object({
    total: t.Integer({ minimum: 0 }),
    limit: t.Integer({ minimum: 1, maximum: 100 }),
    offset: t.Integer({ minimum: 0 }),
  }),
})

export const SessionListQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
})

export const SessionParams = t.Object({
  sessionId: SessionId,
})

export const UpdatePasswordBody = t.Object(
  {
    password: Password,
    oldPassword: t.Optional(Password),
  },
  { additionalProperties: false },
)

export const UpdateAccountNameBody = t.Object(
  {
    name: Name,
  },
  { additionalProperties: false },
)

export const UpdateAccountEmailBody = t.Object(
  {
    email: Email,
    password: Password,
  },
  { additionalProperties: false },
)

export const UpdateAccountPrefsBody = t.Object(
  {
    prefs: Preferences,
  },
  { additionalProperties: false },
)

export { UserResponse }

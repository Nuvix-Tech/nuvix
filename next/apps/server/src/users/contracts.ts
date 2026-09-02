import { t } from 'elysia'
import { Preferences } from '../teams/contracts'

export const SessionId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})

export const UserId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})
export const CreateUserId = t.Union([UserId, t.Literal('unique()')])
export const Name = t.String({ minLength: 1, maxLength: 128, pattern: '.*\\S.*' })
export const Email = t.String({ minLength: 3, maxLength: 320, format: 'email' })
export const Phone = t.String({ pattern: '^\\+[1-9]\\d{1,14}$' })
export const Label = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[\\p{L}\\p{M}\\p{N}._-]+$',
})

export const UserResponse = t.Object({
  $id: UserId,
  name: t.Optional(Name),
  email: t.Optional(Email),
  phone: t.Optional(Phone),
  status: t.Boolean(),
  labels: t.Array(Label),
  prefs: Preferences,
  emailVerification: t.Boolean(),
  phoneVerification: t.Boolean(),
  registration: t.String({ format: 'date-time' }),
  $createdAt: t.String({ format: 'date-time' }),
  $updatedAt: t.String({ format: 'date-time' }),
})

export const UserListResponse = t.Object({
  data: t.Array(UserResponse),
  meta: t.Object({
    total: t.Integer({ minimum: 0 }),
    limit: t.Integer({ minimum: 1, maximum: 100 }),
    offset: t.Integer({ minimum: 0 }),
  }),
})

export const UserParams = t.Object({ userId: UserId })
export const UserMembershipListQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
})
export const UserMembershipResponse = t.Object({
  $id: t.String({ minLength: 1, maxLength: 36 }),
  teamId: t.String({ minLength: 1, maxLength: 36 }),
  teamName: t.Optional(t.String()),
  roles: t.Array(
    t.String({
      minLength: 1,
      maxLength: 32,
      pattern: '^[\\p{L}\\p{M}\\p{N}._-]+$',
    }),
    { maxItems: 100 },
  ),
  status: t.String({ minLength: 1, maxLength: 32 }),
  invited: t.String({ format: 'date-time' }),
  joined: t.Optional(t.String({ format: 'date-time' })),
})
export const UserMembershipListResponse = t.Object({
  data: t.Array(UserMembershipResponse),
  meta: t.Object({
    total: t.Integer({ minimum: 0 }),
    limit: t.Integer({ minimum: 1, maximum: 100 }),
    offset: t.Integer({ minimum: 0 }),
  }),
})
export const CreateUserBody = t.Object(
  {
    userId: t.Optional(CreateUserId),
    email: t.Optional(Email),
    phone: t.Optional(Phone),
    name: t.Optional(Name),
  },
  { additionalProperties: false },
)
export const UserListQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  name: t.Optional(Name),
  email: t.Optional(Email),
  phone: t.Optional(Phone),
  status: t.Optional(t.Boolean()),
  emailVerification: t.Optional(t.Boolean()),
  phoneVerification: t.Optional(t.Boolean()),
})
export const UpdateNameBody = t.Object({ name: Name }, { additionalProperties: false })
export const UpdateEmailBody = t.Object({ email: Email }, { additionalProperties: false })
export const UpdatePhoneBody = t.Object({ phone: Phone }, { additionalProperties: false })
export const UpdatePrefsBody = t.Object({ prefs: Preferences }, { additionalProperties: false })
export const UpdateLabelsBody = t.Object(
  { labels: t.Array(Label, { maxItems: 100 }) },
  { additionalProperties: false },
)
export const UpdateStatusBody = t.Object({ status: t.Boolean() }, { additionalProperties: false })

export const Password = t.String({ minLength: 8, maxLength: 256 })

export const CreateArgon2UserBody = t.Object(
  {
    userId: t.Optional(CreateUserId),
    email: t.Optional(Email),
    phone: t.Optional(Phone),
    password: Password,
    name: t.Optional(Name),
  },
  { additionalProperties: false },
)

export const CreateBcryptUserBody = t.Object(
  {
    userId: t.Optional(CreateUserId),
    email: t.Optional(Email),
    phone: t.Optional(Phone),
    password: Password,
    name: t.Optional(Name),
  },
  { additionalProperties: false },
)

export const UpdateUserPasswordBody = t.Object(
  {
    password: Password,
  },
  { additionalProperties: false },
)

export const UserSessionParams = t.Object({
  userId: UserId,
  sessionId: SessionId,
})

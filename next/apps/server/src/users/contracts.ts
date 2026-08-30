import { t } from 'elysia'
import { Preferences } from '../teams/contracts'

export const UserId = t.String({
  minLength: 1,
  maxLength: 36,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$',
})
const CreateUserId = t.Union([UserId, t.Literal('unique()')])
const Name = t.String({ minLength: 1, maxLength: 128, pattern: '.*\\S.*' })
const Email = t.String({ minLength: 3, maxLength: 320, format: 'email' })
const Phone = t.String({ pattern: '^\\+[1-9]\\d{1,14}$' })
const Label = t.String({
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

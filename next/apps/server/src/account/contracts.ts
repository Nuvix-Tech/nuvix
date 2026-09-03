import { t } from 'elysia'
import { Preferences } from '../teams/contracts'
import { Email, Name, Phone, UserId, UserResponse } from '../users/contracts'

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

export const UpdateAccountPhoneBody = t.Object(
  {
    phone: Phone,
    password: Password,
  },
  { additionalProperties: false },
)

export const UpdateAccountStatusBody = t.Object(
  {
    status: t.Boolean(),
  },
  { additionalProperties: false },
)

export const CreateMagicUrlTokenBody = t.Object(
  {
    userId: UserId,
    url: t.Optional(t.String()),
  },
  { additionalProperties: false },
)

export const ConfirmMagicUrlSessionBody = t.Object(
  {
    userId: UserId,
    secret: t.String(),
  },
  { additionalProperties: false },
)

export const CreatePhoneTokenBody = t.Object(
  {
    userId: UserId,
  },
  { additionalProperties: false },
)

export const ConfirmPhoneSessionBody = t.Object(
  {
    userId: UserId,
    secret: t.String(),
  },
  { additionalProperties: false },
)

export const CreateVerificationBody = t.Object(
  {
    url: t.Optional(t.String()),
  },
  { additionalProperties: false },
)

export const ConfirmVerificationBody = t.Object(
  {
    userId: UserId,
    secret: t.String(),
  },
  { additionalProperties: false },
)

export const CreatePasswordRecoveryBody = t.Object(
  {
    email: Email,
    url: t.Optional(t.String()),
  },
  { additionalProperties: false },
)

export const ConfirmPasswordRecoveryBody = t.Object(
  {
    userId: UserId,
    secret: t.String(),
    password: Password,
  },
  { additionalProperties: false },
)

export const TokenResponse = t.Object({
  $id: t.String(),
  userId: UserId,
  secret: t.String(),
  expire: t.String({ format: 'date-time' }),
  $createdAt: t.String({ format: 'date-time' }),
})

export const UpdateAccountMfaBody = t.Object(
  {
    mfa: t.Boolean(),
  },
  { additionalProperties: false },
)

export const MfaFactorsResponse = t.Object({
  totp: t.Boolean(),
  email: t.Boolean(),
  phone: t.Boolean(),
  recoveryCodes: t.Boolean(),
})

export const MfaAuthenticatorResponse = t.Object({
  $id: t.String(),
  type: t.String(),
  secret: t.String(),
  uri: t.String(),
})

export const VerifyMfaAuthenticatorBody = t.Object(
  {
    otp: t.String({ minLength: 6, maxLength: 6 }),
  },
  { additionalProperties: false },
)

export const MfaRecoveryCodesResponse = t.Object({
  recoveryCodes: t.Array(t.String()),
})

export const CreateMfaChallengeBody = t.Object(
  {
    factor: t.Union([
      t.Literal('totp'),
      t.Literal('recoveryCode'),
      t.Literal('email'),
      t.Literal('phone'),
    ]),
  },
  { additionalProperties: false },
)

export const VerifyMfaChallengeBody = t.Object(
  {
    challengeId: t.Optional(t.String()),
    otp: t.String(),
  },
  { additionalProperties: false },
)

export const MfaChallengeResponse = t.Object({
  $id: t.String(),
  userId: UserId,
  factor: t.String(),
  expiresAt: t.String({ format: 'date-time' }),
})

export const JwtResponse = t.Object(
  {
    jwt: t.String(),
  },
  { additionalProperties: false },
)
export interface JwtResponse {
  readonly jwt: string
}

export { Phone, UserResponse }

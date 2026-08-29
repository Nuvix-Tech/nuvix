import { type Doc, Query } from '@nuvix/db'
import { HEADERS } from '../shared/constants'
import { BadRequestError, ServiceUnavailableError, UnauthorizedError } from '../shared/errors'
import type { AuthMode } from './auth'
import {
  type ParsedCredential,
  parseCredentialToken,
  verifyCredentialSecret,
} from './credential-secret'
import type { ProjectAuthContext, TeamClaim } from './project'
import type { TenantAuthDocuments, TenantAuthInput, TenantAuthResolver } from './project-request'
import { TENANT_AUTH_MODEL, type TenantAuthModel } from './tenant-auth-model'

const MAX_MEMBERSHIPS = 1_000
const DUMMY_VERIFIER = {
  salt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
}

interface TenantAuthOptions {
  readonly model?: TenantAuthModel
  readonly now?: () => Date
}

function invalid(): UnauthorizedError {
  return new UnauthorizedError('Credential is invalid', {
    code: 'credential_invalid',
  })
}

function unavailable(): ServiceUnavailableError {
  return new ServiceUnavailableError('Authentication is temporarily unavailable', {
    code: 'authentication_unavailable',
  })
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function strings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return Object.freeze([...new Set(value)].toSorted())
}

async function get(
  documents: TenantAuthDocuments,
  collection: string,
  id: string,
  fields: string[],
): Promise<Doc> {
  return await documents.getDocument(collection, id, [Query.select(fields)]).catch(() => {
    throw unavailable()
  })
}

async function verify(
  kind: 'session' | 'apiKey',
  credential: ParsedCredential,
  document: Doc,
  digestField: string,
  saltField: string,
): Promise<boolean> {
  const verifier = document.empty()
    ? DUMMY_VERIFIER
    : {
        digest: document.get(digestField, ''),
        salt: document.get(saltField, ''),
      }
  return await verifyCredentialSecret(kind, credential.secret, verifier)
}

function active(expiresAt: unknown, revokedAt: unknown, now: Date): boolean {
  const expiry = date(expiresAt)
  return expiry !== null && expiry.getTime() > now.getTime() && revokedAt === null
}

async function memberships(
  documents: TenantAuthDocuments,
  userId: string,
  model: TenantAuthModel,
): Promise<readonly TeamClaim[]> {
  const fields = model.fields.memberships
  const found = await documents
    .find(model.collections.memberships, [
      Query.equal(fields.userId, [userId]),
      Query.equal(fields.status, ['accepted']),
      Query.select([fields.teamId, fields.roles]),
      Query.limit(MAX_MEMBERSHIPS + 1),
    ])
    .catch(() => {
      throw unavailable()
    })
  if (found.length > MAX_MEMBERSHIPS) throw unavailable()

  return Object.freeze(
    found.map((membership) => {
      const teamId: unknown = membership.get(fields.teamId)
      const roles = strings(membership.get(fields.roles))
      if (typeof teamId !== 'string' || !roles) throw unavailable()
      return Object.freeze({ teamId, roles })
    }),
  )
}

async function userClaims(
  documents: TenantAuthDocuments,
  userId: string,
  model: TenantAuthModel,
): Promise<Pick<ProjectAuthContext & { type: 'session' }, 'verified' | 'labels' | 'teams'>> {
  const fields = model.fields.users
  const user = await get(documents, model.collections.users, userId, [
    fields.status,
    fields.emailVerified,
    fields.phoneVerified,
    fields.labels,
  ])
  if (user.empty() || user.get(fields.status) !== true) throw invalid()

  const emailVerified: unknown = user.get(fields.emailVerified)
  const phoneVerified: unknown = user.get(fields.phoneVerified)
  const labels = strings(user.get(fields.labels))
  if (typeof emailVerified !== 'boolean' || typeof phoneVerified !== 'boolean' || !labels) {
    throw unavailable()
  }

  return Object.freeze({
    verified: emailVerified || phoneVerified,
    labels,
    teams: await memberships(documents, userId, model),
  })
}

async function session(
  input: TenantAuthInput,
  token: string,
  model: TenantAuthModel,
  now: Date,
): Promise<ProjectAuthContext> {
  const credential = parseCredentialToken('session', token)
  if (!credential) throw invalid()
  const fields = model.fields.sessions
  const stored = await get(input.documents, model.collections.sessions, credential.id, [
    fields.userId,
    fields.secretDigest,
    fields.secretSalt,
    fields.expiresAt,
    fields.revokedAt,
  ])
  const secretValid = await verify(
    'session',
    credential,
    stored,
    fields.secretDigest,
    fields.secretSalt,
  )
  if (!secretValid || stored.empty()) throw invalid()

  const userId: unknown = stored.get(fields.userId)
  if (
    typeof userId !== 'string' ||
    !active(stored.get(fields.expiresAt), stored.get(fields.revokedAt), now)
  ) {
    throw invalid()
  }
  const claims = await userClaims(input.documents, userId, model)
  return Object.freeze({
    type: 'session',
    sessionId: credential.id,
    userId,
    scopes: Object.freeze([]),
    ...claims,
  })
}

function mode(value: string | null): AuthMode | null {
  if (value === null) return 'admin'
  return value === 'admin' || value === 'console' ? value : null
}

async function apiKey(
  input: TenantAuthInput,
  token: string,
  model: TenantAuthModel,
  now: Date,
): Promise<ProjectAuthContext> {
  const credential = parseCredentialToken('apiKey', token)
  const requestedMode = mode(input.headers.get(HEADERS.mode))
  if (!credential || !requestedMode) throw invalid()
  const fields = model.fields.apiKeys
  const stored = await get(input.documents, model.collections.apiKeys, credential.id, [
    fields.secretDigest,
    fields.secretSalt,
    fields.scopes,
    fields.modes,
    fields.enabled,
    fields.expiresAt,
    fields.revokedAt,
  ])
  const secretValid = await verify(
    'apiKey',
    credential,
    stored,
    fields.secretDigest,
    fields.secretSalt,
  )
  if (!secretValid || stored.empty() || stored.get(fields.enabled) !== true) throw invalid()

  const modes = strings(stored.get(fields.modes))
  const scopes = strings(stored.get(fields.scopes))
  if (!modes || !scopes) throw unavailable()
  if (!modes.includes(requestedMode)) throw invalid()
  const expiresAt: unknown = stored.get(fields.expiresAt)
  if (expiresAt !== null && !active(expiresAt, stored.get(fields.revokedAt), now)) throw invalid()
  if (stored.get(fields.revokedAt) !== null) throw invalid()

  return Object.freeze({
    type: 'apiKey',
    keyId: credential.id,
    mode: requestedMode,
    scopes,
  })
}

/** Concrete tenant-local auth. JWTs remain fail-closed until tenant key storage lands. */
export function createTenantAuthResolver(options: TenantAuthOptions = {}): TenantAuthResolver {
  const model = options.model ?? TENANT_AUTH_MODEL
  const now = options.now ?? (() => new Date())

  return Object.freeze({
    async resolve(input: TenantAuthInput): Promise<ProjectAuthContext> {
      const credentials = [HEADERS.session, HEADERS.jwt, HEADERS.apiKey].filter((header) =>
        input.headers.has(header),
      )
      if (credentials.length === 0) return Object.freeze({ type: 'guest' })
      if (credentials.length > 1) {
        throw new BadRequestError('Multiple authentication credentials are not allowed', {
          code: 'auth_credentials_conflict',
        })
      }

      if (credentials[0] === HEADERS.session) {
        return await session(input, input.headers.get(HEADERS.session)!, model, now())
      }
      if (credentials[0] === HEADERS.apiKey) {
        return await apiKey(input, input.headers.get(HEADERS.apiKey)!, model, now())
      }

      // Tenant signing-key storage and strict JWT claims are implemented in Phase 4.
      throw invalid()
    },
  })
}

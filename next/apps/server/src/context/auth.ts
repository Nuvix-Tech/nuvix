/** Safe authentication identities after tenant-local verification. */
export type AuthMode = 'admin' | 'console'

export type AuthContext =
  | { type: 'guest' }
  | { type: 'session'; sessionId: string; userId: string }
  | { type: 'jwt'; userId: string; sessionId?: string }
  | { type: 'apiKey'; keyId: string; mode: AuthMode }

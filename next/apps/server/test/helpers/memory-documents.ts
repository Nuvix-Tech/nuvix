import { Doc, type Query } from '@nuvix/db'
import type { AccountDocuments } from '../../src/account/documents'

export interface MemoryAccountDocuments extends AccountDocuments {
  readonly users: Map<string, Doc>
  readonly sessions: Map<string, Doc>
  readonly memberships: Map<string, Doc>
  readonly teamTotals: Map<string, number>
  readonly jwtKeys: Map<string, Doc>
  readonly tokens: Map<string, Doc>
  readonly authenticators: Map<string, Doc>
}

export function memoryDocuments(): MemoryAccountDocuments {
  const users = new Map<string, Doc>()
  const sessions = new Map<string, Doc>()
  const memberships = new Map<string, Doc>()
  const teamTotals = new Map<string, number>()
  const jwtKeys = new Map<string, Doc>()
  const tokens = new Map<string, Doc>()
  const authenticators = new Map<string, Doc>()

  const self: AccountDocuments = {
    getUser: async (id: string) => users.get(id) ?? new Doc(),
    findUsers: async (queries: Query[] = []) => {
      const all = [...users.values()]
      let result = all
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'email') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((u) => u.get('email') === target)
        }
      }
      return result
    },
    createUser: async (doc: Doc) => {
      const now = new Date()
      const stored = new Doc({
        ...doc.getAll(),
        $id: doc.getId(),
        $createdAt: doc.createdAt() ?? now,
        $updatedAt: doc.updatedAt() ?? now,
      })
      users.set(stored.getId(), stored)
      return stored
    },
    updateUser: async (id: string, doc: Doc) => {
      const existing = users.get(id) ?? new Doc({ $id: id })
      const now = new Date()
      const merged = new Doc({
        ...existing.getAll(),
        ...doc.getAll(),
        $id: id,
        $createdAt: existing.createdAt() ?? now,
        $updatedAt: now,
      })
      users.set(id, merged)
      return merged
    },
    deleteUser: async (id: string) => users.delete(id),

    getToken: async (id: string) => tokens.get(id) ?? new Doc(),
    findTokens: async (queries: Query[] = []) => {
      let result = [...tokens.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((t) => t.get('userId') === target)
        }
        if (q.getMethod() === 'equal' && q.getAttribute() === 'type') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((t) => t.get('type') === target)
        }
      }
      return result
    },
    createToken: async (doc: Doc) => {
      const now = new Date()
      const stored = new Doc({
        ...doc.getAll(),
        $id: doc.getId(),
        $createdAt: doc.createdAt() ?? now,
        $updatedAt: doc.updatedAt() ?? now,
      })
      tokens.set(stored.getId(), stored)
      return stored
    },
    deleteToken: async (id: string) => tokens.delete(id),

    getAuthenticator: async (id: string) => authenticators.get(id) ?? new Doc(),
    findAuthenticators: async (queries: Query[] = []) => {
      let result = [...authenticators.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((a) => a.get('userId') === target)
        }
        if (q.getMethod() === 'equal' && q.getAttribute() === 'type') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((a) => a.get('type') === target)
        }
        if (q.getMethod() === 'equal' && q.getAttribute() === 'verified') {
          const target = (q.getValues() as boolean[])[0]
          result = result.filter((a) => Boolean(a.get('verified')) === target)
        }
      }
      return result
    },
    createAuthenticator: async (doc: Doc) => {
      const now = new Date()
      const stored = new Doc({
        ...doc.getAll(),
        $id: doc.getId(),
        $createdAt: doc.createdAt() ?? now,
        $updatedAt: doc.updatedAt() ?? now,
      })
      authenticators.set(stored.getId(), stored)
      return stored
    },
    updateAuthenticator: async (id: string, doc: Doc) => {
      const existing = authenticators.get(id) ?? new Doc({ $id: id })
      const now = new Date()
      const merged = new Doc({
        ...existing.getAll(),
        ...doc.getAll(),
        $id: id,
        $createdAt: existing.createdAt() ?? now,
        $updatedAt: now,
      })
      authenticators.set(id, merged)
      return merged
    },
    deleteAuthenticator: async (id: string) => authenticators.delete(id),

    getSession: async (id: string) => sessions.get(id) ?? new Doc(),
    findSessions: async (queries: Query[] = []) => {
      let result = [...sessions.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((s) => s.get('userId') === target)
        }
        if (q.getMethod() === 'isNull' && q.getAttribute() === 'revokedAt') {
          result = result.filter(
            (s) => s.get('revokedAt') === null || s.get('revokedAt') === undefined,
          )
        }
      }
      return result
    },
    countSessions: async (queries: Query[] = []) => {
      const res = await self.findSessions(queries)
      return res.length
    },
    createSession: async (doc: Doc) => {
      const now = new Date()
      const stored = new Doc({
        ...doc.getAll(),
        $id: doc.getId(),
        $createdAt: doc.createdAt() ?? now,
        $updatedAt: doc.updatedAt() ?? now,
      })
      sessions.set(stored.getId(), stored)
      return stored
    },
    updateSession: async (id: string, doc: Doc) => {
      const existing = sessions.get(id) ?? new Doc({ $id: id })
      const now = new Date()
      const merged = new Doc({
        ...existing.getAll(),
        ...doc.getAll(),
        $id: id,
        $createdAt: existing.createdAt() ?? now,
        $updatedAt: now,
      })
      sessions.set(id, merged)
      return merged
    },
    deleteSession: async (id: string) => sessions.delete(id),

    findMemberships: async (queries: Query[] = []) => {
      let result = [...memberships.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'userId') {
          const target = (q.getValues() as string[])[0]
          result = result.filter((m) => m.get('userId') === target)
        }
      }
      return result
    },
    deleteMembership: async (id: string) => memberships.delete(id),
    decreaseTeamTotal: async (teamId: string) => {
      const current = teamTotals.get(teamId) ?? 1
      const next = Math.max(0, current - 1)
      teamTotals.set(teamId, next)
      return new Doc({ $id: teamId, total: next })
    },

    findJwtKeys: async (queries: Query[] = []) => {
      let result = [...jwtKeys.values()]
      for (const q of queries) {
        if (q.getMethod() === 'equal' && q.getAttribute() === 'active') {
          const target = (q.getValues() as boolean[])[0]
          result = result.filter((k) => k.get('active') === target)
        }
      }
      return result
    },
    createJwtKey: async (doc: Doc) => {
      const now = new Date()
      const stored = new Doc({
        ...doc.getAll(),
        $id: doc.getId(),
        $createdAt: doc.createdAt() ?? now,
        $updatedAt: doc.updatedAt() ?? now,
      })
      jwtKeys.set(stored.getId(), stored)
      return stored
    },
    updateJwtKey: async (id: string, doc: Doc) => {
      const existing = jwtKeys.get(id) ?? new Doc({ $id: id })
      const now = new Date()
      const merged = new Doc({
        ...existing.getAll(),
        ...doc.getAll(),
        $id: id,
        $createdAt: existing.createdAt() ?? now,
        $updatedAt: now,
      })
      jwtKeys.set(id, merged)
      return merged
    },

    transaction: async <Result>(op: (docs: AccountDocuments) => Promise<Result>) => op(self),
  }

  return {
    ...self,
    users,
    sessions,
    memberships,
    teamTotals,
    jwtKeys,
    tokens,
    authenticators,
  }
}

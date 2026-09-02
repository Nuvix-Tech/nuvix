import { Doc, type Query } from '@nuvix/db'
import type { AccountDocuments } from '../../src/account/documents'

export interface MemoryAccountDocuments extends AccountDocuments {
  readonly users: Map<string, Doc>
  readonly sessions: Map<string, Doc>
  readonly memberships: Map<string, Doc>
  readonly teamTotals: Map<string, number>
}

export function memoryDocuments(): MemoryAccountDocuments {
  const users = new Map<string, Doc>()
  const sessions = new Map<string, Doc>()
  const memberships = new Map<string, Doc>()
  const teamTotals = new Map<string, number>()

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

    transaction: async <Result>(op: (docs: AccountDocuments) => Promise<Result>) => op(self),
  }

  return {
    ...self,
    users,
    sessions,
    memberships,
    teamTotals,
  }
}

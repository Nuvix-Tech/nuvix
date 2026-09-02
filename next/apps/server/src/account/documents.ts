import type { Doc, Query, Session } from '@nuvix/db'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { TEAM_MODEL } from '../teams/model'

export interface AccountDocuments {
  // User operations
  getUser(userId: string): Promise<Doc>
  findUsers(queries?: Query[]): Promise<Doc[]>
  createUser(document: Doc): Promise<Doc>
  updateUser(userId: string, document: Doc): Promise<Doc>
  deleteUser(userId: string): Promise<boolean>

  // Session operations
  getSession(sessionId: string): Promise<Doc>
  findSessions(queries?: Query[]): Promise<Doc[]>
  countSessions(queries?: Query[], max?: number): Promise<number>
  createSession(document: Doc): Promise<Doc>
  updateSession(sessionId: string, document: Doc): Promise<Doc>
  deleteSession(sessionId: string): Promise<boolean>

  // Memberships & team aggregate cleanup on user deletion
  findMemberships(queries?: Query[]): Promise<Doc[]>
  deleteMembership(membershipId: string): Promise<boolean>
  decreaseTeamTotal(teamId: string): Promise<Doc>

  // JWT signing keys
  findJwtKeys(queries?: Query[]): Promise<Doc[]>
  createJwtKey(document: Doc): Promise<Doc>
  updateJwtKey(keyId: string, document: Doc): Promise<Doc>

  // Transaction support
  transaction<Result>(operation: (documents: AccountDocuments) => Promise<Result>): Promise<Result>
}

export function accountDocuments(session: Session): AccountDocuments {
  const usersCollection = TENANT_AUTH_MODEL.collections.users
  const sessionsCollection = TENANT_AUTH_MODEL.collections.sessions
  const membershipsCollection = TENANT_AUTH_MODEL.collections.memberships
  const jwtKeysCollection = TENANT_AUTH_MODEL.collections.jwtKeys
  const teamsCollection = TEAM_MODEL.collection
  const teamTotalField = TEAM_MODEL.fields.total

  return Object.freeze({
    getUser: (userId: string) => session.getDocument(usersCollection, userId),
    findUsers: (queries?: Query[]) => session.find(usersCollection, queries),
    createUser: (document: Doc) => session.createDocument(usersCollection, document),
    updateUser: (userId: string, document: Doc) =>
      session.updateDocument(usersCollection, userId, document),
    deleteUser: (userId: string) => session.deleteDocument(usersCollection, userId),

    getSession: (sessionId: string) => session.getDocument(sessionsCollection, sessionId),
    findSessions: (queries?: Query[]) => session.find(sessionsCollection, queries),
    countSessions: (queries?: Query[], max?: number) =>
      session.count(sessionsCollection, queries, max),
    createSession: (document: Doc) => session.createDocument(sessionsCollection, document),
    updateSession: (sessionId: string, document: Doc) =>
      session.updateDocument(sessionsCollection, sessionId, document),
    deleteSession: (sessionId: string) => session.deleteDocument(sessionsCollection, sessionId),

    findMemberships: (queries?: Query[]) => session.find(membershipsCollection, queries),
    deleteMembership: (membershipId: string) =>
      session.deleteDocument(membershipsCollection, membershipId),
    decreaseTeamTotal: (teamId: string) =>
      session.decreaseDocumentAttribute(teamsCollection, teamId, teamTotalField, 1, 0),

    findJwtKeys: (queries?: Query[]) => session.find(jwtKeysCollection, queries),
    createJwtKey: (document: Doc) => session.createDocument(jwtKeysCollection, document),
    updateJwtKey: (keyId: string, document: Doc) =>
      session.updateDocument(jwtKeysCollection, keyId, document),

    transaction: <Result>(operation: (documents: AccountDocuments) => Promise<Result>) =>
      session.withTransaction((tx) => operation(accountDocuments(tx))),
  })
}

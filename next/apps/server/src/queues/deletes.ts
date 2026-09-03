import type { Session } from '@nuvix/db'
import { Query } from '@nuvix/db'
import { TENANT_AUTH_MODEL } from '../context/tenant-auth-model'
import { STORAGE_MODEL } from '../storage/model'

export interface StorageDeviceDeleter {
  deletePath(path: string): Promise<boolean>
}

export interface DeletesWorker {
  deleteUserCascade(
    session: Session,
    userId: string,
  ): Promise<{
    sessionsDeleted: number
    membershipsDeleted: number
  }>
  deleteBucketCascade(
    session: Session,
    device: StorageDeviceDeleter,
    bucketId: string,
  ): Promise<{
    objectsDeleted: number
    deviceCleaned: boolean
  }>
  deleteExpiredSessions(session: Session, expiredBeforeIso: string): Promise<number>
}

export function createDeletesWorker(): DeletesWorker {
  return {
    async deleteUserCascade(session, userId) {
      let sessionsDeleted = 0
      let membershipsDeleted = 0

      // 1. Delete user's active sessions
      const sessions = await session.find(TENANT_AUTH_MODEL.collections.sessions, [
        Query.equal(TENANT_AUTH_MODEL.fields.sessions.userId, [userId]),
      ])
      for (const s of sessions) {
        const ok = await session.deleteDocument(TENANT_AUTH_MODEL.collections.sessions, s.getId())
        if (ok) sessionsDeleted++
      }

      // 2. Delete user's team memberships
      const memberships = await session.find(TENANT_AUTH_MODEL.collections.memberships, [
        Query.equal(TENANT_AUTH_MODEL.fields.memberships.userId, [userId]),
      ])
      for (const m of memberships) {
        const ok = await session.deleteDocument(
          TENANT_AUTH_MODEL.collections.memberships,
          m.getId(),
        )
        if (ok) membershipsDeleted++
      }

      return { sessionsDeleted, membershipsDeleted }
    },

    async deleteBucketCascade(session, device, bucketId) {
      let objectsDeleted = 0

      // 1. Delete all metadata object records in this bucket
      const objects = await session.find(STORAGE_MODEL.collections.objects, [
        Query.equal(STORAGE_MODEL.fields.objects.bucketId, [bucketId]),
      ])
      for (const obj of objects) {
        const ok = await session.deleteDocument(STORAGE_MODEL.collections.objects, obj.getId())
        if (ok) objectsDeleted++
      }

      // 2. Clean storage device physical path
      let deviceCleaned = false
      try {
        deviceCleaned = await device.deletePath(bucketId)
      } catch {
        deviceCleaned = false
      }

      return { objectsDeleted, deviceCleaned }
    },

    async deleteExpiredSessions(session, expiredBeforeIso) {
      let deleted = 0
      const expired = await session.find(TENANT_AUTH_MODEL.collections.sessions, [
        Query.lessThan('$createdAt', expiredBeforeIso),
      ])
      for (const s of expired) {
        const ok = await session.deleteDocument(TENANT_AUTH_MODEL.collections.sessions, s.getId())
        if (ok) deleted++
      }
      return deleted
    },
  }
}

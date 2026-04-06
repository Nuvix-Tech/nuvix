import { Logger } from '@nestjs/common'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Audit } from '@nuvix/audit'
import { CoreService } from '@nuvix/core'
import {
  Authorization,
  Database,
  Doc,
  DuplicateException,
  ID,
  Permission,
  Role,
} from '@nuvix/db'
import { configuration, PRIVATE_COLLECTIONS } from '@nuvix/utils'
import collections from '@nuvix/utils/collections'
import { AccountService } from '../account/account.service'
import { ProjectService } from '../projects/projects.service'

export async function initSetup(app: NestFastifyApplication) {
  const logger = new Logger('Setup')
  const coreService = app.get(CoreService)
  try {
    logger.log('🚀 Initializing Nuvix server setup...')
    const db = coreService.getInternalDatabase()

    await db.create().catch(e => {
      if (e instanceof DuplicateException) {
        logger.log('✓ Database already exists, skipping creation')
        return
      }
      throw e
    })

    try {
      await db.getCache().flush()
      await db
        .exists(undefined, Database.METADATA)
        .then(is => (is ? undefined : db.create()))
      logger.log('✓ Platform database initialized successfully')
    } catch (e) {
      if (!(e instanceof DuplicateException)) {
        throw e
      }
      logger.log('✓ Platform database already exists')
    }

    logger.log('📦 Setting up collections and resources...')
    await Authorization.skip(async () => {
      const internalCollections = collections.internal
      for (const [_, collection] of Object.entries(internalCollections)) {
        if (collection.$collection !== Database.METADATA) {
          continue
        }
        if (await db.exists(db.schema, collection.$id)) {
          continue
        }

        logger.log(`  ➜ Creating collection: ${collection.$id}`)

        const attributes = collection.attributes.map(
          attribute => new Doc(attribute),
        )

        const indexes = (collection.indexes ?? []).map(index => new Doc(index))
        const isPrivateCollection = PRIVATE_COLLECTIONS.includes(collection.$id)

        await db.createCollection({
          id: collection.$id,
          attributes,
          indexes,
          permissions: isPrivateCollection
            ? [
                Permission.read(Role.any()),
                Permission.create(Role.any()),
                Permission.update(Role.any()),
                Permission.delete(Role.any()),
              ]
            : [Permission.create(Role.any())],
          documentSecurity: !isPrivateCollection,
        })
      }

      const defaultBucket = await db.getDocument('buckets', 'default')
      if (defaultBucket.empty() && !(await db.exists(db.schema, 'bucket_1'))) {
        logger.log('📁 Creating default storage bucket...')

        await db.createDocument(
          'buckets',
          new Doc({
            $id: 'default',
            $collection: 'buckets',
            name: 'Default',
            maximumFileSize: 10 * 1024 * 1024, // 10MB
            allowedFileExtensions: [],
            enabled: true,
            compression: 'gzip',
            encryption: true,
            antivirus: true,
            fileSecurity: true,
            $permissions: [
              Permission.read(Role.any()),
              Permission.create(Role.any()),
              Permission.update(Role.any()),
              Permission.delete(Role.any()),
            ],
            search: 'buckets Default',
          }),
        )

        const bucket = await db.getDocument('buckets', 'default')
        logger.log('  ➜ Creating files collection for default bucket')

        const files = collections.bucket.files
        if (!files) {
          throw new Error('Files collection is not configured.')
        }

        const fileAttributes = files.attributes.map(
          attribute => new Doc(attribute),
        )

        const fileIndexes = files.indexes?.map(index => new Doc(index))

        await db.createCollection({
          id: `bucket_${bucket.getSequence()}`,
          attributes: fileAttributes,
          indexes: fileIndexes,
        })
      }
      if (!(await db.exists(db.schema, Audit.COLLECTION))) {
        logger.log('📋 Setting up audit logging system')
        await new Audit(db).setup()
      }

      const accountService = app.get(AccountService)
      const projectService = app.get(ProjectService)
      const hasSuperUser = await db.findOne('users')
      if (!hasSuperUser.empty()) {
        logger.log('✓ Admin user already exists, skipping creation')
      } else {
        const adminEmail = process.env.NUVIX_ADMIN_EMAIL
        const adminPassword = process.env.NUVIX_ADMIN_PASSWORD

        if (!adminEmail || !adminPassword) {
          throw new Error(
            '❌ NUVIX_ADMIN_EMAIL and NUVIX_ADMIN_PASSWORD environment variables are required for initial setup',
          )
        }

        logger.log(`👤 Creating admin user with email: ${adminEmail}`)
        const adminUser = await accountService.createAccount(
          ID.unique(),
          adminEmail,
          adminPassword,
          'Super Admin',
          new Doc(),
          '',
        )
        const teamId = ID.custom('my-team')
        const team = await db.createDocument(
          'teams',
          new Doc({
            $id: teamId,
            name: 'My Team',
            total: 1,
            $permissions: [
              Permission.read(Role.user(adminUser.getId())),
              Permission.update(Role.user(adminUser.getId())),
              Permission.delete(Role.user(adminUser.getId())),
              Permission.read(Role.team(teamId)),
              Permission.update(Role.team(teamId)),
            ],
          }),
        )
        await db.createDocument(
          'memberships',
          new Doc({
            $id: ID.unique(),
            teamInternalId: team.getSequence(),
            teamId: teamId,
            userInternalId: adminUser.getSequence(),
            userId: adminUser.getId(),
            joined: new Date(),
            confirm: true,
            roles: ['owner'],
            $permissions: [
              Permission.read(Role.user(adminUser.getId())),
              Permission.update(Role.user(adminUser.getId())),
              Permission.read(Role.team(teamId)),
              Permission.update(Role.team(teamId)),
              Permission.delete(Role.team(teamId)),
            ],
          }),
        )

        const projectId = configuration.app.projectId
        await projectService.create({
          projectId,
          teamId,
          name: 'My Project',
          password: '',
          region: 'local',
        })
        logger.log(`✓ Default project created with ID: ${projectId}`)
      }

      logger.log('✅ Nuvix server setup completed successfully!')
      logger.log('🎉 Your self-hosted Nuvix instance is ready to use')
      await db.getCache().flush()
    })
  } catch (error: any) {
    logger.error(`❌ Setup failed: ${error.message}`, error.stack)
    throw error
  }
}

import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { JwtService } from '@nestjs/jwt'
import { CoreService } from '@nuvix/core'
import { Exception } from '@nuvix/core/extend/exception'
import { MessagingJob, MessagingJobData } from '@nuvix/core/resolvers'
import { Database, Doc, ID, Query } from '@nuvix/db'
import {
  AppEvents,
  configuration,
  MessageStatus,
  MessageType,
  QueueFor,
  ScheduleResourceType,
} from '@nuvix/utils'
import type { Messages, Schedules } from '@nuvix/utils/types'
import { Queue } from 'bullmq'
import type {
  CreateEmailMessage,
  CreatePushMessage,
  CreateSmsMessage,
  ListMessages,
  ListTargets,
  UpdateEmailMessage,
  UpdatePushMessage,
  UpdateSmsMessage,
} from './messaging.types'

@Injectable()
export class MessagingService {
  private readonly internalDb: Database
  private readonly db: Database

  constructor(
    private readonly coreService: CoreService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QueueFor.MESSAGING)
    private readonly queue: Queue<MessagingJobData, any, MessagingJob>,
  ) {
    this.internalDb = this.coreService.getInternalDatabase()
    this.db = this.coreService.getDatabase()
  }

  /**
   * Create Email Message
   */
  async createEmailMessage({ input }: CreateEmailMessage) {
    const {
      messageId: inputMessageId,
      subject,
      content,
      topics = [],
      users = [],
      targets = [],
      cc = [],
      bcc = [],
      attachments = [],
      draft = false,
      html = false,
      scheduledAt = null,
    } = input

    const messageId =
      inputMessageId === 'unique()' ? ID.unique() : inputMessageId

    const status = draft
      ? MessageStatus.DRAFT
      : scheduledAt
        ? MessageStatus.SCHEDULED
        : MessageStatus.PROCESSING

    if (
      status !== MessageStatus.DRAFT &&
      topics.length === 0 &&
      users.length === 0 &&
      targets.length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    if (status === MessageStatus.SCHEDULED && !scheduledAt) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    const mergedTargets = [...targets, ...cc, ...bcc]

    if (mergedTargets.length > 0) {
      const foundTargets = await this.db.find('targets', qb =>
        qb
          .equal('$id', ...mergedTargets)
          .equal('providerType', MessageType.EMAIL)
          .limit(mergedTargets.length),
      )

      if (foundTargets.length !== mergedTargets.length) {
        throw new Exception(Exception.MESSAGE_TARGET_NOT_EMAIL)
      }

      for (const target of foundTargets) {
        if (target.empty()) {
          throw new Exception(Exception.USER_TARGET_NOT_FOUND)
        }
      }
    }

    const processedAttachments = []
    if (attachments.length > 0) {
      for (const attachment of attachments) {
        const [bucketId, fileId] = attachment.split(':') as [string, string]

        const bucket = await this.db.getDocument('buckets', bucketId)
        if (bucket.empty()) {
          throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
        }

        const file = await this.db.getDocument(
          `bucket_${bucket.getSequence()}`,
          fileId,
        )
        if (file.empty()) {
          throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
        }

        processedAttachments.push({
          bucketId,
          fileId,
        })
      }
    }

    const message = new Doc<Messages>({
      $id: messageId,
      providerType: MessageType.EMAIL,
      topics,
      users,
      targets,
      scheduledAt,
      data: {
        subject,
        content,
        html,
        cc,
        bcc,
        attachments: processedAttachments,
      },
      status,
    })

    const createdMessage = await this.db.createDocument('messages', message)

    switch (status) {
      case MessageStatus.PROCESSING:
        await this.queue.add(MessagingJob.EXTERNAL, {
          message: createdMessage,
        })
        break
      case MessageStatus.SCHEDULED: {
        const schedule = new Doc<Schedules>({
          resourceType: ScheduleResourceType.MESSAGE,
          resourceId: createdMessage.getId(),
          resourceInternalId: createdMessage.getSequence(),
          resourceUpdatedAt: new Date().toISOString(),
          schedule: scheduledAt,
          active: true,
          region: configuration.app.region,
        })

        const createdSchedule = await this.internalDb.createDocument(
          'schedules',
          schedule,
        )
        createdMessage.set('scheduleId', createdSchedule.getId())
        createdMessage.set('scheduleInternalId', createdSchedule.getSequence())
        await this.db.updateDocument(
          'messages',
          createdMessage.getId(),
          createdMessage,
        )
        break
      }
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_CREATE, {
      messageId: createdMessage.getId(),
      payload: {
        data: createdMessage,
      },
    })

    return createdMessage
  }

  /**
   * Create SMS Message
   */
  async createSmsMessage({ input }: CreateSmsMessage) {
    const {
      messageId: inputMessageId,
      content,
      topics = [],
      users = [],
      targets = [],
      draft = false,
      scheduledAt = null,
    } = input

    const messageId =
      inputMessageId === 'unique()' ? ID.unique() : inputMessageId

    const status = draft
      ? MessageStatus.DRAFT
      : scheduledAt
        ? MessageStatus.SCHEDULED
        : MessageStatus.PROCESSING

    if (
      status !== MessageStatus.DRAFT &&
      topics.length === 0 &&
      users.length === 0 &&
      targets.length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    if (status === MessageStatus.SCHEDULED && !scheduledAt) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    if (targets.length > 0) {
      const foundTargets = await this.db.find('targets', qb =>
        qb
          .equal('$id', ...targets)
          .equal('providerType', MessageType.SMS)
          .limit(targets.length),
      )

      if (foundTargets.length !== targets.length) {
        throw new Exception(Exception.MESSAGE_TARGET_NOT_SMS)
      }

      for (const target of foundTargets) {
        if (target.empty()) {
          throw new Exception(Exception.USER_TARGET_NOT_FOUND)
        }
      }
    }

    const message = new Doc<Messages>({
      $id: messageId,
      providerType: MessageType.SMS,
      topics,
      users,
      targets,
      scheduledAt,
      data: {
        content,
      },
      status,
    })

    const createdMessage = await this.db.createDocument('messages', message)

    switch (status) {
      case MessageStatus.PROCESSING:
        await this.queue.add(MessagingJob.EXTERNAL, {
          message: createdMessage,
        })
        break
      case MessageStatus.SCHEDULED: {
        const schedule = Doc.from<Schedules>({
          resourceType: ScheduleResourceType.MESSAGE,
          resourceId: createdMessage.getId(),
          resourceInternalId: createdMessage.getSequence(),
          resourceUpdatedAt: new Date().toISOString(),
          schedule: scheduledAt ?? undefined,
          active: true,
          region: configuration.app.region,
        })

        const createdSchedule = await this.internalDb.createDocument(
          'schedules',
          schedule,
        )
        createdMessage.set('scheduleId', createdSchedule.getId())
        createdMessage.set('scheduleInternalId', createdSchedule.getSequence())
        await this.db.updateDocument(
          'messages',
          createdMessage.getId(),
          createdMessage,
        )
        break
      }
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_CREATE, {
      messageId: createdMessage.getId(),
      payload: {
        data: createdMessage,
      },
    })

    return createdMessage
  }

  /**
   * Create Push Message
   */
  async createPushMessage({ input }: CreatePushMessage) {
    const {
      messageId: inputMessageId,
      title = '',
      body = '',
      topics = [],
      users = [],
      targets = [],
      data = null,
      action = '',
      image = '',
      icon = '',
      sound = '',
      color = '',
      tag = '',
      badge = -1,
      draft = false,
      scheduledAt = null,
      contentAvailable = false,
      critical = false,
      priority = 'high',
    } = input

    const messageId =
      inputMessageId === 'unique()' ? ID.unique() : inputMessageId

    const status = draft
      ? MessageStatus.DRAFT
      : scheduledAt
        ? MessageStatus.SCHEDULED
        : MessageStatus.PROCESSING

    if (
      status !== MessageStatus.DRAFT &&
      topics.length === 0 &&
      users.length === 0 &&
      targets.length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    if (status === MessageStatus.SCHEDULED && !scheduledAt) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    if (targets.length > 0) {
      const foundTargets = await this.db.find('targets', qb =>
        qb
          .equal('$id', ...targets)
          .equal('providerType', MessageType.PUSH)
          .limit(targets.length),
      )

      if (foundTargets.length !== targets.length) {
        throw new Exception(Exception.MESSAGE_TARGET_NOT_PUSH)
      }

      for (const target of foundTargets) {
        if (target.empty()) {
          throw new Exception(Exception.USER_TARGET_NOT_FOUND)
        }
      }
    }

    let processedImage: any = null
    if (image) {
      const [bucketId, fileId] = image.split(':') as [string, string]

      const bucket = await this.db.getDocument('buckets', bucketId)
      if (bucket.empty()) {
        throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
      }

      const file = await this.db.getDocument(
        `bucket_${bucket.getSequence()}`,
        fileId,
      )
      if (file.empty()) {
        throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
      }

      const allowedMimeTypes = ['image/png', 'image/jpeg']
      if (!allowedMimeTypes.includes(file.get('mimeType'))) {
        throw new Exception(Exception.STORAGE_FILE_TYPE_UNSUPPORTED)
      }

      const host = configuration.server.host || 'localhost'
      const protocol = configuration.app.forceHttps ? 'https' : 'http'
      const scheduleTime = scheduledAt

      // Set expiry to 15 days from now
      let expiry: number
      if (scheduleTime) {
        const expiryDate = new Date(scheduleTime)
        expiryDate.setDate(expiryDate.getDate() + 15)
        expiry = Math.floor(expiryDate.getTime() / 1000)
      } else {
        const expiryDate = new Date()
        expiryDate.setDate(expiryDate.getDate() + 15)
        expiry = Math.floor(expiryDate.getTime() / 1000)
      }

      const jwt = this.jwtService.sign(
        {
          bucketId: bucket.getId(),
          fileId: file.getId(),
        },
        {
          expiresIn: expiry,
          algorithm: 'HS256',
        },
      )

      processedImage = {
        bucketId: bucket.getId(),
        fileId: file.getId(),
        url: `${protocol}://${host}/v1/storage/buckets/${bucket.getId()}/files/${file.getId()}/push?jwt=${jwt}`,
      }
    }

    const pushData: Record<string, any> = {}

    if (title) {
      pushData.title = title
    }
    if (body) {
      pushData.body = body
    }
    if (data) {
      pushData.data = data
    }
    if (action) {
      pushData.action = action
    }
    if (processedImage) {
      pushData.image = processedImage
    }
    if (icon) {
      pushData.icon = icon
    }
    if (sound) {
      pushData.sound = sound
    }
    if (color) {
      pushData.color = color
    }
    if (tag) {
      pushData.tag = tag
    }
    if (badge >= 0) {
      pushData.badge = badge
    }
    if (contentAvailable) {
      pushData.contentAvailable = true
    }
    if (critical) {
      pushData.critical = true
    }
    if (priority) {
      pushData.priority = priority
    }

    const message = new Doc<Messages>({
      $id: messageId,
      providerType: MessageType.PUSH,
      topics,
      users,
      targets,
      scheduledAt,
      data: pushData,
      status,
    })

    const createdMessage = await this.db.createDocument('messages', message)

    switch (status) {
      case MessageStatus.PROCESSING:
        await this.queue.add(MessagingJob.EXTERNAL, {
          message: createdMessage,
        })
        break
      case MessageStatus.SCHEDULED: {
        const schedule = Doc.from<Schedules>({
          resourceType: ScheduleResourceType.MESSAGE,
          resourceId: createdMessage.getId(),
          resourceInternalId: createdMessage.getSequence(),
          resourceUpdatedAt: new Date().toISOString(),
          region: configuration.app.region,
          schedule: scheduledAt ?? undefined,
          active: true,
        })

        const createdSchedule = await this.internalDb.createDocument(
          'schedules',
          schedule,
        )
        createdMessage.set('scheduleId', createdSchedule.getId())
        createdMessage.set('scheduleInternalId', createdSchedule.getSequence())
        await this.db.updateDocument(
          'messages',
          createdMessage.getId(),
          createdMessage,
        )
        break
      }
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_CREATE, {
      messageId: createdMessage.getId(),
      payload: {
        data: createdMessage,
      },
    })

    return createdMessage
  }

  /**
   * Lists all messages.
   */
  async listMessages({ queries = [], search }: ListMessages) {
    if (search) {
      queries.push(Query.search('search', search))
    }

    const { filters } = Query.groupByType(queries)

    const messages = await this.db.find('messages', queries)
    const total = await this.db.count('messages', filters)

    return {
      data: messages,
      total,
    }
  }

  /**
   * Get Message
   */
  async getMessage(id: string) {
    const message = await this.db.getDocument('messages', id)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    return message
  }

  /**
   *  List targets for a message.
   */
  async listTargets({ messageId, queries = [] }: ListTargets) {
    const message = await this.db.getDocument('messages', messageId)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    const targetIDs = message.get('targets')
    if (!targetIDs || targetIDs.length === 0) {
      return {
        data: [],
        total: 0,
      }
    }

    const { filters } = Query.groupByType(queries)

    queries.push(Query.equal('$id', targetIDs))
    const targets = await this.db.find('targets', queries)
    const total = await this.db.count('targets', filters)

    return {
      data: targets,
      total,
    }
  }

  /**
   * Update Email Message
   */
  async updateEmailMessage({ messageId, input }: UpdateEmailMessage) {
    const message = await this.db.getDocument('messages', messageId)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    let status: string
    if (input.draft !== undefined || input.scheduledAt !== undefined) {
      if (input.draft) {
        status = MessageStatus.DRAFT
      } else {
        status = input.scheduledAt
          ? MessageStatus.SCHEDULED
          : MessageStatus.PROCESSING
      }
    } else {
      status = message.get('status')
    }

    if (
      status !== MessageStatus.DRAFT &&
      (input.topics ?? message.get('topics', [])).length === 0 &&
      (input.users ?? message.get('users', [])).length === 0 &&
      (input.targets ?? message.get('targets', [])).length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    const currentScheduledAt = message.get('scheduledAt')

    switch (message.get('status')) {
      case MessageStatus.PROCESSING:
        throw new Exception(Exception.MESSAGE_ALREADY_PROCESSING)
      case MessageStatus.SENT:
        throw new Exception(Exception.MESSAGE_ALREADY_SENT)
      case MessageStatus.FAILED:
        throw new Exception(Exception.MESSAGE_ALREADY_FAILED)
    }

    if (
      status === MessageStatus.SCHEDULED &&
      !input.scheduledAt &&
      !currentScheduledAt
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    if (
      currentScheduledAt &&
      new Date(currentScheduledAt as string) < new Date()
    ) {
      throw new Exception(Exception.MESSAGE_ALREADY_SCHEDULED)
    }

    if (!currentScheduledAt && input.scheduledAt) {
      const schedule = Doc.from<Schedules>({
        resourceType: 'message',
        resourceId: message.getId(),
        resourceInternalId: message.getSequence(),
        resourceUpdatedAt: new Date().toISOString(),
        region: configuration.app.region,
        schedule: input.scheduledAt,
        active: status === MessageStatus.SCHEDULED,
      })

      const createdSchedule = await this.internalDb.createDocument(
        'schedules',
        schedule,
      )
      message.set('scheduleId', createdSchedule.getId())
      message.set('scheduleInternalId', createdSchedule.getSequence())
    }

    if (currentScheduledAt) {
      const schedule = await this.internalDb.getDocument(
        'schedules',
        message.get('scheduleId'),
      )
      const scheduledStatus = status === MessageStatus.SCHEDULED

      if (schedule.empty()) {
        throw new Exception(Exception.SCHEDULE_NOT_FOUND)
      }

      schedule
        .set('resourceUpdatedAt', new Date().toISOString())
        .set('active', scheduledStatus)

      if (input.scheduledAt) {
        schedule.set('schedule', input.scheduledAt)
      }

      await this.internalDb.updateDocument(
        'schedules',
        schedule.getId(),
        schedule,
      )
    }

    if (input.scheduledAt) {
      message.set('scheduledAt', input.scheduledAt)
    }

    if (input.topics !== undefined) {
      message.set('topics', input.topics)
    }

    if (input.users !== undefined) {
      message.set('users', input.users)
    }

    if (input.targets !== undefined) {
      message.set('targets', input.targets)
    }

    const data = message.get('data')

    if (input.subject !== undefined) {
      data.subject = input.subject
    }

    if (input.content !== undefined) {
      data.content = input.content
    }

    if (input.attachments !== undefined) {
      const processedAttachments = []
      for (const attachment of input.attachments) {
        const [bucketId, fileId] = attachment.split(':') as [string, string]

        const bucket = await this.db.getDocument('buckets', bucketId)
        if (bucket.empty()) {
          throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
        }

        const file = await this.db.getDocument(
          `bucket_${bucket.getSequence()}`,
          fileId,
        )
        if (file.empty()) {
          throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
        }

        processedAttachments.push({
          bucketId,
          fileId,
        })
      }
      data.attachments = processedAttachments
    }

    if (input.html !== undefined) {
      data.html = input.html
    }

    if (input.cc !== undefined) {
      data.cc = input.cc
    }

    if (input.bcc !== undefined) {
      data.bcc = input.bcc
    }

    message.set('data', data)
    if (status) {
      message.set('status', status)
    }

    const updatedMessage = await this.db.updateDocument(
      'messages',
      message.getId(),
      message,
    )

    if (status === MessageStatus.PROCESSING) {
      await this.queue.add(MessagingJob.EXTERNAL, {
        message: updatedMessage,
      })
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_UPDATE, {
      messageId: updatedMessage.getId(),
      payload: {
        data: updatedMessage,
      },
    })

    return updatedMessage
  }

  /**
   * Update SMS Message
   */
  async updateSmsMessage({ messageId, input }: UpdateSmsMessage) {
    const message = await this.db.getDocument('messages', messageId)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    let status: string
    if (input.draft !== undefined || input.scheduledAt !== undefined) {
      if (input.draft) {
        status = MessageStatus.DRAFT
      } else {
        status = input.scheduledAt
          ? MessageStatus.SCHEDULED
          : MessageStatus.PROCESSING
      }
    } else {
      status = message.get('status')
    }

    if (
      status !== MessageStatus.DRAFT &&
      (input.topics ?? message.get('topics', [])).length === 0 &&
      (input.users ?? message.get('users', [])).length === 0 &&
      (input.targets ?? message.get('targets', [])).length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    const currentScheduledAt = message.get('scheduledAt')

    switch (message.get('status')) {
      case MessageStatus.PROCESSING:
        throw new Exception(Exception.MESSAGE_ALREADY_PROCESSING)
      case MessageStatus.SENT:
        throw new Exception(Exception.MESSAGE_ALREADY_SENT)
      case MessageStatus.FAILED:
        throw new Exception(Exception.MESSAGE_ALREADY_FAILED)
    }

    if (
      status === MessageStatus.SCHEDULED &&
      !input.scheduledAt &&
      !currentScheduledAt
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    if (
      currentScheduledAt &&
      new Date(currentScheduledAt as string) < new Date()
    ) {
      throw new Exception(Exception.MESSAGE_ALREADY_SCHEDULED)
    }

    if (!currentScheduledAt && input.scheduledAt) {
      const schedule = Doc.from<Schedules>({
        resourceType: ScheduleResourceType.MESSAGE,
        resourceId: message.getId(),
        resourceInternalId: message.getSequence(),
        resourceUpdatedAt: new Date().toISOString(),
        region: configuration.app.region,
        schedule: input.scheduledAt,
        active: status === MessageStatus.SCHEDULED,
      })

      const createdSchedule = await this.internalDb.createDocument(
        'schedules',
        schedule,
      )
      message.set('scheduleId', createdSchedule.getId())
      message.set('scheduleInternalId', createdSchedule.getSequence())
    }

    if (currentScheduledAt) {
      const schedule = await this.internalDb.getDocument(
        'schedules',
        message.get('scheduleId'),
      )
      const scheduledStatus = status === MessageStatus.SCHEDULED

      if (schedule.empty()) {
        throw new Exception(Exception.SCHEDULE_NOT_FOUND)
      }

      schedule
        .set('resourceUpdatedAt', new Date().toISOString())
        .set('active', scheduledStatus)

      if (input.scheduledAt) {
        schedule.set('schedule', input.scheduledAt)
      }

      await this.internalDb.updateDocument(
        'schedules',
        schedule.getId(),
        schedule,
      )
    }

    if (input.scheduledAt) {
      message.set('scheduledAt', input.scheduledAt)
    }

    if (input.topics !== undefined) {
      message.set('topics', input.topics)
    }

    if (input.users !== undefined) {
      message.set('users', input.users)
    }

    if (input.targets !== undefined) {
      message.set('targets', input.targets)
    }

    const data = message.get('data')

    if (input.content !== undefined) {
      data.content = input.content
    }

    message.set('data', data)

    if (status) {
      message.set('status', status)
    }

    const updatedMessage = await this.db.updateDocument(
      'messages',
      message.getId(),
      message,
    )

    if (status === MessageStatus.PROCESSING) {
      await this.queue.add(MessagingJob.EXTERNAL, {
        message: updatedMessage,
      })
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_UPDATE, {
      messageId: updatedMessage.getId(),
      payload: {
        data: updatedMessage,
      },
    })

    return updatedMessage
  }

  /**
   * Update Push Message
   */
  async updatePushMessage({ messageId, input }: UpdatePushMessage) {
    const message = await this.db.getDocument('messages', messageId)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    let status: string
    if (input.draft !== undefined || input.scheduledAt !== undefined) {
      if (input.draft) {
        status = MessageStatus.DRAFT
      } else {
        status = input.scheduledAt
          ? MessageStatus.SCHEDULED
          : MessageStatus.PROCESSING
      }
    } else {
      status = message.get('status')
    }

    if (
      status !== MessageStatus.DRAFT &&
      (input.topics ?? message.get('topics', [])).length === 0 &&
      (input.users ?? message.get('users', [])).length === 0 &&
      (input.targets ?? message.get('targets', [])).length === 0
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_TARGET)
    }

    const currentScheduledAt = message.get('scheduledAt')

    switch (message.get('status')) {
      case MessageStatus.PROCESSING:
        throw new Exception(Exception.MESSAGE_ALREADY_PROCESSING)
      case MessageStatus.SENT:
        throw new Exception(Exception.MESSAGE_ALREADY_SENT)
      case MessageStatus.FAILED:
        throw new Exception(Exception.MESSAGE_ALREADY_FAILED)
    }

    if (
      status === MessageStatus.SCHEDULED &&
      !input.scheduledAt &&
      !currentScheduledAt
    ) {
      throw new Exception(Exception.MESSAGE_MISSING_SCHEDULE)
    }

    if (
      currentScheduledAt &&
      new Date(currentScheduledAt as string) < new Date()
    ) {
      throw new Exception(Exception.MESSAGE_ALREADY_SCHEDULED)
    }

    if (!currentScheduledAt && input.scheduledAt) {
      const schedule = Doc.from<Schedules>({
        resourceType: ScheduleResourceType.MESSAGE,
        resourceId: message.getId(),
        resourceInternalId: message.getSequence(),
        resourceUpdatedAt: new Date().toISOString(),
        region: configuration.app.region,
        schedule: input.scheduledAt,
        active: status === MessageStatus.SCHEDULED,
      })

      const createdSchedule = await this.internalDb.createDocument(
        'schedules',
        schedule,
      )
      message.set('scheduleId', createdSchedule.getId())
      message.set('scheduleInternalId', createdSchedule.getSequence())
    }

    // Handle schedule updates
    if (currentScheduledAt) {
      const schedule = await this.internalDb.getDocument(
        'schedules',
        message.get('scheduleId'),
      )
      const scheduledStatus = status === MessageStatus.SCHEDULED

      if (schedule.empty()) {
        throw new Exception(Exception.SCHEDULE_NOT_FOUND)
      }

      schedule
        .set('resourceUpdatedAt', new Date().toISOString())
        .set('active', scheduledStatus)

      if (input.scheduledAt) {
        schedule.set('schedule', input.scheduledAt)
      }

      await this.internalDb.updateDocument(
        'schedules',
        schedule.getId(),
        schedule,
      )
    }

    if (input.scheduledAt) {
      message.set('scheduledAt', input.scheduledAt)
    }

    if (input.topics !== undefined) {
      message.set('topics', input.topics)
    }

    if (input.users !== undefined) {
      message.set('users', input.users)
    }

    if (input.targets !== undefined) {
      message.set('targets', input.targets)
    }

    const pushData = message.get('data')
    if (input.title !== undefined) {
      pushData.title = input.title
    }

    if (input.body !== undefined) {
      pushData.body = input.body
    }

    if (input.data !== undefined) {
      pushData.data = input.data
    }

    if (input.action !== undefined) {
      pushData.action = input.action
    }

    if (input.icon !== undefined) {
      pushData.icon = input.icon
    }

    if (input.sound !== undefined) {
      pushData.sound = input.sound
    }

    if (input.color !== undefined) {
      pushData.color = input.color
    }

    if (input.tag !== undefined) {
      pushData.tag = input.tag
    }

    if (input.badge !== undefined) {
      pushData.badge = input.badge
    }

    if (input.contentAvailable !== undefined) {
      pushData.contentAvailable = input.contentAvailable
    }

    if (input.critical !== undefined) {
      pushData.critical = input.critical
    }

    if (input.priority !== undefined) {
      pushData.priority = input.priority
    }

    if (input.image !== undefined) {
      const [bucketId, fileId] = input.image.split(':') as [string, string]

      const bucket = await this.db.getDocument('buckets', bucketId)
      if (bucket.empty()) {
        throw new Exception(Exception.STORAGE_BUCKET_NOT_FOUND)
      }

      const file = await this.db.getDocument(
        `bucket_${bucket.getSequence()}`,
        fileId,
      )
      if (file.empty()) {
        throw new Exception(Exception.STORAGE_FILE_NOT_FOUND)
      }

      const allowedMimeTypes = ['image/png', 'image/jpeg']
      if (!allowedMimeTypes.includes(file.get('mimeType'))) {
        throw new Exception(Exception.STORAGE_FILE_TYPE_UNSUPPORTED)
      }

      const host = configuration.server.host || 'localhost'
      const protocol = configuration.app.forceHttps ? 'https' : 'http'

      const scheduleTime = currentScheduledAt || input.scheduledAt
      let expiry: number
      if (scheduleTime) {
        const expiryDate = new Date(scheduleTime as string)
        expiryDate.setDate(expiryDate.getDate() + 15)
        expiry = Math.floor(expiryDate.getTime() / 1000)
      } else {
        const expiryDate = new Date()
        expiryDate.setDate(expiryDate.getDate() + 15)
        expiry = Math.floor(expiryDate.getTime() / 1000)
      }

      const jwt = this.jwtService.sign(
        {
          bucketId: bucket.getId(),
          fileId: file.getId(),
        },
        {
          expiresIn: expiry,
          algorithm: 'HS256',
        },
      )

      pushData.image = {
        bucketId: bucket.getId(),
        fileId: file.getId(),
        url: `${protocol}://${host}/v1/storage/buckets/${bucket.getId()}/files/${file.getId()}/push?jwt=${jwt}`,
      }
    }

    message.set('data', pushData)

    if (status) {
      message.set('status', status)
    }

    const updatedMessage = await this.db.updateDocument(
      'messages',
      message.getId(),
      message,
    )

    if (status === MessageStatus.PROCESSING) {
      await this.queue.add(MessagingJob.EXTERNAL, {
        message: updatedMessage,
      })
    }

    this.eventEmitter.emit(AppEvents.MESSAGES_UPDATE, {
      messageId: updatedMessage.getId(),
      payload: {
        data: updatedMessage,
      },
    })

    return updatedMessage
  }

  /**
   * Deletes a message.
   */
  async deleteMessage(messageId: string) {
    const message = await this.db.getDocument('messages', messageId)

    if (message.empty()) {
      throw new Exception(Exception.MESSAGE_NOT_FOUND)
    }

    switch (message.get('status')) {
      case MessageStatus.PROCESSING:
        throw new Exception(Exception.MESSAGE_ALREADY_PROCESSING)
      case MessageStatus.SCHEDULED: {
        const scheduleId = message.get('scheduleId')
        const scheduledAt = message.get('scheduledAt')
        const now = new Date()
        const scheduledDate = new Date(scheduledAt as string)
        if (now > scheduledDate) {
          throw new Exception(Exception.MESSAGE_ALREADY_SCHEDULED)
        }

        if (scheduleId) {
          try {
            await this.internalDb.deleteDocument('schedules', scheduleId)
          } catch {
            // Ignore
          }
        }
        break
      }
      default:
        break
    }

    await this.db.deleteDocument('messages', message.getId())

    this.eventEmitter.emit(AppEvents.MESSAGES_DELETE, {
      messageId,
    })
  }
}

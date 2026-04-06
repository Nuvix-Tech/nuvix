import * as fs from 'node:fs'
import { OnWorkerEvent, Processor } from '@nestjs/bullmq'
import { Logger, OnModuleDestroy } from '@nestjs/common'
import { configuration, QueueFor } from '@nuvix/utils'
import { Job } from 'bullmq'
import Template from 'handlebars'
import { createTransport, Transporter } from 'nodemailer'
import SMTPPool from 'nodemailer/lib/smtp-pool'
import type { SmtpConfig } from '../../config/smtp'
import { Queue } from './queue'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BATCH_SIZE = 50
const SEND_RETRY_ATTEMPTS = 3
const SEND_RETRY_DELAY_MS = 1000

@Processor(QueueFor.MAILS, { concurrency: 25 })
export class MailsQueue extends Queue implements OnModuleDestroy {
  private readonly logger = new Logger(MailsQueue.name)
  private readonly transporter: Transporter<
    SMTPPool.SentMessageInfo,
    SMTPPool.Options
  >
  private readonly templateCache = new Map<string, Template.TemplateDelegate>()
  private isShuttingDown = false

  constructor() {
    super()
    const config = configuration.smtp

    this.transporter = createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 10,
      rateDelta: 1000,
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user || config.password
          ? { user: config.user, pass: config.password }
          : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      tls: { rejectUnauthorized: !configuration.app.isProduction },
    })

    this.transporter.on('error', err => {
      this.logger.error(`Transporter error: ${err.message}`, err.stack)
    })
  }

  async onModuleDestroy() {
    this.isShuttingDown = true
    this.logger.log('Shutting down mail queue, closing transporter pool...')
    this.transporter.close()
    this.templateCache.clear()
  }

  async process(job: Job<MailQueueOptions | MailsQueueOptions>) {
    if (this.isShuttingDown) {
      throw new Error('Mail queue is shutting down, requeue job')
    }

    if (job.name !== MailJob.SEND_EMAIL) {
      this.logger.warn(`Unknown job name: ${job.name}, skipping`)
      return null
    }

    const { subject, variables = {}, server } = job.data

    this.validateJobData(job.data)

    if (!configuration.smtp.enabled() && !server?.host) {
      throw new Error(
        'SMTP configuration missing: no default SMTP and no server override provided',
      )
    }

    const emails = this.resolveRecipients(job.data)

    let customTransporter: Transporter | null = null
    const transporter = server?.host
      ? (customTransporter = this.createCustomTransport(server))
      : this.transporter

    try {
      if (server?.host) {
        await this.verifyTransporter(customTransporter!)
      }

      const protocol = configuration.app.forceHttps ? 'https' : 'http'
      const hostname = configuration.app.host

      const templateVariables = {
        ...variables,
        host: `${protocol}://${hostname}`,
        subject,
        year: new Date().getFullYear(),
      }

      const bodyTemplatePath =
        job.data.bodyTemplate ??
        configuration.assets.resolve('locale/templates/email-base-styled.tpl')

      const bodyTemplate = this.loadTemplate(bodyTemplatePath)
      const renderedBody = bodyTemplate(templateVariables)

      const results: MailSendResult[] = []
      const batches = this.chunk(emails, MAX_BATCH_SIZE)

      for (const batch of batches) {
        const batchResults = await Promise.allSettled(
          batch.map(email =>
            this.sendMailWithRetry({
              transporter,
              email,
              subject,
              body: renderedBody,
            }),
          ),
        )

        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i]
          if (result?.status === 'fulfilled') {
            results.push({
              email: batch[i],
              status: 'sent',
              messageId: result.value,
            })
          } else {
            results.push({
              email: batch[i],
              status: 'failed',
              error: result?.reason?.message,
            })
            this.logger.error(
              `Failed to send email to ${batch[i]}: ${result?.reason?.message}`,
            )
          }
        }

        await job.updateProgress(
          Math.round((results.length / emails.length) * 100),
        )
      }

      const sent = results.filter(r => r.status === 'sent').length
      const failed = results.filter(r => r.status === 'failed').length

      if (failed > 0 && sent === 0) {
        throw new Error(
          `All ${failed} emails failed to send. First error: ${results.find(r => r.status === 'failed')?.error}`,
        )
      }

      if (failed > 0) {
        this.logger.warn(
          `Job ${job.id}: ${sent}/${emails.length} emails sent, ${failed} failed`,
        )
      }

      return {
        status: sent === emails.length ? 'success' : 'partial',
        sent,
        failed,
        results,
      }
    } finally {
      if (customTransporter) {
        customTransporter.close()
      }
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`)
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} of type ${job.name} completed successfully`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: any) {
    this.logger.error(
      `Job ${job.id} of type ${job.name} failed (attempt ${job.attemptsMade}): ${err.message}`,
      err.stack,
    )
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} has stalled`)
  }

  private validateJobData(data: MailQueueOptions | MailsQueueOptions) {
    if (!data.subject?.trim()) {
      throw new Error('Email subject is required and cannot be empty')
    }

    if (!data.body?.trim()) {
      throw new Error('Email body is required and cannot be empty')
    }

    if (data.bodyTemplate && !fs.existsSync(data.bodyTemplate)) {
      throw new Error(`Email template not found: ${data.bodyTemplate}`)
    }
  }

  private resolveRecipients(
    data: MailQueueOptions | MailsQueueOptions,
  ): string[] {
    const rawEmails = 'email' in data ? [data.email] : data.emails

    if (!rawEmails?.length) {
      throw new Error('No recipient emails provided')
    }

    const emails = [...new Set(rawEmails.map(e => e.trim().toLowerCase()))]

    const invalid = emails.filter(e => !EMAIL_REGEX.test(e))
    if (invalid.length > 0) {
      throw new Error(`Invalid email addresses: ${invalid.join(', ')}`)
    }

    return emails
  }

  private loadTemplate(path: string): Template.TemplateDelegate {
    const cached = this.templateCache.get(path)
    if (cached) return cached

    if (!fs.existsSync(path)) {
      throw new Error(`Template file not found: ${path}`)
    }

    const source = fs.readFileSync(path, 'utf8')
    const compiled = Template.compile(source)
    this.templateCache.set(path, compiled)
    return compiled
  }

  private async sendMailWithRetry(
    params: SendMailParams,
  ): Promise<string | undefined> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.sendMail(params)
      } catch (err: any) {
        lastError = err

        // Don't retry on permanent failures (4xx client errors, invalid addresses)
        if (this.isPermanentFailure(err)) {
          throw err
        }

        if (attempt < SEND_RETRY_ATTEMPTS) {
          const delay = SEND_RETRY_DELAY_MS * 2 ** (attempt - 1)
          this.logger.warn(
            `Send attempt ${attempt}/${SEND_RETRY_ATTEMPTS} failed for ${params.email}, retrying in ${delay}ms: ${err.message}`,
          )
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  private async sendMail({
    transporter,
    email,
    subject,
    body,
  }: SendMailParams): Promise<string | undefined> {
    const info = await transporter.sendMail({
      from: transporter.options.from ?? transporter.options.sender,
      to: email,
      subject,
      html: body,
      text: this.convertHtmlToPlainText(body),
    })
    return info?.messageId
  }

  private async verifyTransporter(transporter: Transporter): Promise<void> {
    try {
      await transporter.verify()
    } catch (err: any) {
      throw new Error(`SMTP connection verification failed: ${err.message}`)
    }
  }

  private isPermanentFailure(err: any): boolean {
    const code = err?.responseCode ?? err?.code
    if (typeof code === 'number' && code >= 400 && code < 500) return true
    if (err?.code === 'EENVELOPE') return true
    return false
  }

  private convertHtmlToPlainText(html: string): string {
    return html
      .replace(/<\/p>/g, '\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private createCustomTransport(options: SmtpConfig): Transporter {
    return createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth:
        options.username || options.password
          ? { user: options.username, pass: options.password }
          : undefined,
      from: { name: options.senderName, address: options.senderEmail },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    } as any)
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size))
    }
    return chunks
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

interface Variables {
  [key: string]: string | number | boolean
}

interface SendMailParams {
  transporter: Transporter
  email: string
  subject: string
  body: string
}

interface MailSendResult {
  email?: string
  status: 'sent' | 'failed'
  messageId?: string
  error?: string
}

export interface MailQueueOptions {
  email: string
  subject: string
  body: string
  variables?: Variables
  server?: SmtpConfig
  bodyTemplate?: string
}

export interface MailsQueueOptions extends Omit<MailQueueOptions, 'email'> {
  emails: string[]
}

export enum MailJob {
  SEND_EMAIL = 'send_email',
}

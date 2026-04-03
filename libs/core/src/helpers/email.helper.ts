import { configuration } from '@nuvix/utils'
import { ProjectsDoc } from '@nuvix/utils/types'
import fs from 'fs/promises'
import Handlebars from 'handlebars'
import path from 'path'
import type { SmtpConfig } from '../config'

export interface BuiltEmail {
  email: string
  subject: string
  body: string
  server?: SmtpConfig
  variables: Record<string, any>
}

export class EmailHelper {
  private templateCache = new Map<string, Function>()

  constructor() {}

  builder(project: ProjectsDoc) {
    return EmailBuilder.create(this, project)
  }

  async render(templateFile: string, data: Record<string, any>) {
    const compiled = await this.getCompiledTemplate(templateFile)
    return compiled(data)
  }

  private async getCompiledTemplate(templateFile: string) {
    if (this.templateCache.has(templateFile)) {
      return this.templateCache.get(templateFile)!
    }

    const templatePath = path.join(configuration.assets.templates, templateFile)

    const source = await fs.readFile(templatePath, 'utf8')
    const compiled = Handlebars.compile(source)

    this.templateCache.set(templateFile, compiled)

    return compiled
  }

  /* ---------------------------------- */
  /* SMTP Resolution                    */
  /* ---------------------------------- */

  resolveSmtp(
    project: ProjectsDoc,
    customTemplate: any,
  ): SmtpConfig | undefined {
    const smtp = project.get('smtp', {}) as SmtpConfig
    const smtpEnabled = smtp.enabled ?? false

    if (!smtpEnabled) {
      return undefined
    }

    let senderEmail =
      configuration.smtp.emailFrom ?? configuration.app.emailTeam
    let senderName: string = configuration.app.name

    let replyTo = ''

    if (smtp.senderEmail) senderEmail = smtp.senderEmail
    if (smtp.senderName) senderName = smtp.senderName
    if (smtp.replyTo) replyTo = smtp.replyTo

    if (customTemplate?.senderEmail) senderEmail = customTemplate.senderEmail

    if (customTemplate?.senderName) senderName = customTemplate.senderName

    if (customTemplate?.replyTo) replyTo = customTemplate.replyTo

    return {
      host: smtp.host,
      port: smtp.port,
      username: smtp.username,
      password: smtp.password,
      secure: smtp.secure ?? false,
      senderEmail,
      senderName,
      replyTo,
    }
  }
}

type EmailState = {
  email?: string
  templateFile?: string
  templateKey?: string
  subject?: string
  templateData?: Record<string, any>
  variables?: Record<string, any>
}

type RequiredKeys = 'email' | 'templateFile' | 'templateKey' | 'subject'

type AllRequired<S extends EmailState> =
  S extends Required<Pick<EmailState, RequiredKeys>> ? true : false

export class EmailBuilder<S extends EmailState = {}> {
  private constructor(
    private readonly helper: EmailHelper,
    private readonly project: ProjectsDoc,
    private readonly state: S,
  ) {}

  static create(helper: EmailHelper, project: ProjectsDoc) {
    return new EmailBuilder(helper, project, {})
  }

  to(email: string) {
    return new EmailBuilder(this.helper, this.project, { ...this.state, email })
  }

  usingTemplate(file: string, key: string) {
    return new EmailBuilder(this.helper, this.project, {
      ...this.state,
      templateFile: file,
      templateKey: key,
    })
  }

  withSubject(subject: string) {
    return new EmailBuilder(this.helper, this.project, {
      ...this.state,
      subject,
    })
  }

  withData(data: Record<string, any>) {
    return new EmailBuilder(this.helper, this.project, {
      ...this.state,
      templateData: data,
    })
  }

  withVariables(vars: Record<string, any>) {
    return new EmailBuilder(this.helper, this.project, {
      ...this.state,
      variables: vars,
    })
  }

  async build(
    this: AllRequired<S> extends true ? EmailBuilder<S> : never,
  ): Promise<BuiltEmail> {
    const customTemplate =
      this.project.get('templates', {})?.[`email.${this.state.templateKey}`] ??
      null

    const rendered = await this.helper.render(
      this.state.templateFile!,
      this.state.templateData ?? {},
    )

    const finalSubject = customTemplate?.subject ?? this.state.subject!
    const finalBody = customTemplate?.message ?? rendered
    const smtpServer = this.helper.resolveSmtp(this.project, customTemplate)

    return Object.freeze({
      email: this.state.email!,
      subject: finalSubject,
      body: finalBody,
      server: smtpServer,
      variables: this.state.variables ?? {},
    })
  }
}

export const emailHelper = new EmailHelper()

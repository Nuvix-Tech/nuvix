import { IsString, IsOptional, IsBoolean, IsArray, IsUrl, ValidateNested } from 'class-validator'

export class CreateWebhookDTO {
  /**
   * Webhook name/label for identification.
   */
  @IsString()
  declare name: string

  /**
   * Target URL to send webhook events to.
   */
  @IsUrl()
  declare url: string

  /**
   * Events to subscribe to (e.g., 'user.create', 'files.upload').
   */
  @IsArray()
  @IsString({ each: true })
  declare events: string[]

  /**
   * Whether the webhook is active.
   */
  @IsOptional()
  @IsBoolean()
  active?: boolean = true

  /**
   * Secret key for HMAC signature verification. If not provided, one will be generated.
   */
  @IsOptional()
  @IsString()
  secret?: string

  /**
   * Optional metadata for the webhook.
   */
  @IsOptional()
  @ValidateNested()
  metadata?: Record<string, any>
}

export class UpdateWebhookDTO {
  /**
   * Webhook name/label for identification.
   */
  @IsOptional()
  @IsString()
  name?: string

  /**
   * Target URL to send webhook events to.
   */
  @IsOptional()
  @IsUrl()
  url?: string

  /**
   * Events to subscribe to.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[]

  /**
   * Whether the webhook is active.
   */
  @IsOptional()
  @IsBoolean()
  active?: boolean

  /**
   * Secret key for HMAC signature verification.
   */
  @IsOptional()
  @IsString()
  secret?: string

  /**
   * Optional metadata for the webhook.
   */
  @IsOptional()
  @ValidateNested()
  metadata?: Record<string, any>
}

export class TestWebhookDTO {
  /**
   * Event type to simulate.
   */
  @IsString()
  declare event: string

  /**
   * Payload data to send.
   */
  @IsOptional()
  declare payload?: Record<string, any>
}

export class WebhookParamsDTO {
  /**
   * Webhook ID.
   */
  @IsString()
  declare webhookId: string
}
import { Database, Doc } from '@nuvix/db'
import { AppMode, configuration, Schema } from '@nuvix/utils'
import type {
  ProjectsDoc,
  SessionsDoc,
  TeamsDoc,
  UsersDoc,
} from '@nuvix/utils/types'
import type { AuthType } from '../decorators'
import { Exception } from '../extend/exception'
import { RedirectValidator } from '../validators'
import { Platform } from '../validators/network/platform'
import { Detector } from './detector.helper'
import type { Key } from './key.helper'
import { localeTranslatorInstance } from './locale.helper'

export class RequestContext {
  private _allowedHostnames?: string[]
  private _allowedSchemes?: string[]

  project: ProjectsDoc = new Doc()
  user: UsersDoc = new Doc()
  team?: TeamsDoc
  session?: SessionsDoc
  locale = 'en'
  apiKey?: Key
  scopes?: string[]
  role?: string
  mode: AppMode = AppMode.DEFAULT
  authType?: AuthType
  namespace?: string
  currentSchema?: Schema
  authMeta: AuthMeta = {}

  errorMessage?: string
  currentSchemaDB?: Database
  sensitiveFields: string[] = []

  cookieDomain = configuration.server.cookieDomain
  cookieSameSite = configuration.server.cookieSameSite

  _isAPIUser = false // This is set to true if the user is authenticated via API key
  _isAdminUser = false // This is set to true if the user has admin privileges (mostly for console users)

  get isAPIUser() {
    return this._isAPIUser
  }

  get isAdminUser() {
    return this._isAdminUser
  }

  public isPrivilegedUser() {
    return this.isAdminUser || this.isAPIUser
  }

  public getSession() {
    return this.session as SessionsDoc
  }

  /**
   * Returns a locale translator instance for translating messages based on the request's locale.
   */
  public translator() {
    // In the future, we can enhance this to return different translator instances based on the context (e.g., user preferences, project settings, etc.)
    return localeTranslatorInstance
  }

  /**
   * Returns a detector instance for detecting device, browser, and OS information based on the user agent string.
   */
  public detector(userAgent = 'UNKNOWN') {
    return new Detector(userAgent)
  }

  /**
   * Returns the allowed hostnames for the project based on its configured platforms. This is used for validating redirect URLs and callback URLs to prevent open redirect vulnerabilities.
   * The allowed hostnames are cached after the first retrieval for performance optimization.
   */
  public getAllowedHostnames(): string[] {
    if (this._allowedHostnames !== undefined) {
      return this._allowedHostnames
    }

    this._allowedHostnames = Platform.getHostnames(
      this.project.get('platforms'),
    )
    return this._allowedHostnames
  }

  /**
   * Returns the allowed schemes for the project based on its configured platforms. This is used for validating redirect URLs and callback URLs to prevent open redirect vulnerabilities.
   * The allowed schemes are cached after the first retrieval for performance optimization.
   * By default, it includes 'exp' for Expo apps and a custom scheme for Nuvix callbacks, in addition to schemes derived from the project's platforms.
   */
  public getAllowedSchemes(): string[] {
    if (this._allowedSchemes !== undefined) {
      return this._allowedSchemes
    }

    this._allowedSchemes = [
      'exp',
      `nuvix-callback-${this.project.getId()}`,
      ...Platform.getSchemes(this.project.get('platforms')),
    ]
    return this._allowedSchemes
  }

  public validateRedirectURL(url: string) {
    const allowedHostnames = this.getAllowedHostnames()
    const allowedSchemes = this.getAllowedSchemes()

    const validator = new RedirectValidator(allowedHostnames, allowedSchemes)
    if (!validator.$valid(url)) {
      throw new Exception(Exception.GENERAL_BAD_REQUEST, validator.$description)
    }
  }

  public getExposedSchemas(): string[] {
    return this.project.get('metadata')?.allowedSchemas || []
  }

  constructor(init?: Partial<RequestContext>) {
    Object.assign(this, init)
  }
}

type AuthMeta = {
  id?: string
  secret?: string
}

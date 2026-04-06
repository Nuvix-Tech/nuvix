import { Exclude, Expose } from 'class-transformer'

@Exclude()
export abstract class BaseModel {
  /**
   *  ID.
   */
  @Expose() declare $id: string
  /**
   * User creation date in ISO 8601 format.
   */
  @Expose() declare $createdAt: Date
  /**
   * User update date in ISO 8601 format.
   */
  @Expose() declare $updatedAt: Date

  @Expose() declare $permissions: string[]

  @Exclude() declare $collection: string

  constructor(doc?: any) {
    Object.assign(this, doc)
  }
}

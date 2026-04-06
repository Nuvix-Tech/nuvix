import { Exclude, Expose, Transform, Type } from 'class-transformer'
import { AttributeModel } from './Attribute.model'
import { BaseModel } from './base.model'
import { IndexModel } from './Index.model'

@Exclude()
export class CollectionModel extends BaseModel {
  /**
   * Schema ID.
   */
  @Expose() $schema = ''

  /**
   * Collection name.
   */
  @Expose() name = ''

  /**
   * Collection enabled. Can be 'enabled' or 'disabled'.
   * When disabled, the collection is inaccessible to users,
   * but remains accessible to Server SDKs using API keys.
   */
  @Expose() declare enabled: boolean

  /**
   * Whether document-level permissions are enabled.
   */
  @Expose() declare documentSecurity: boolean

  /**
   * Collection attributes.
   */
  @Expose()
  @Transform(({ obj }) => {
    return (obj?.attributes ?? ([] as any[])).map((att: any) => {
      return new AttributeModel(att)
    })
  })
  attributes: any[] = []

  /**
   * Collection indexes.
   */
  @Expose()
  @Type(() => IndexModel)
  indexes: IndexModel[] = []

  constructor(partial: Partial<CollectionModel>) {
    super()
    Object.assign(this, partial)
  }
}

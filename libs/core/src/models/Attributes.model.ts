import { AttributeType, OnDelete, RelationSide, RelationType } from '@nuvix/db'
import { AttributeFormat } from '@nuvix/utils'
import type { Attributes } from '@nuvix/utils/types'
import { Exclude, Expose, Transform } from 'class-transformer'
import { AttributeModel } from './Attribute.model'

@Exclude()
export class AttributeBooleanModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.Boolean
  @Expose() override default: boolean | null = null

  constructor(partial: Partial<AttributeBooleanModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeDatetimeModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.Timestamptz
  @Expose() override format: AttributeFormat = AttributeFormat.DATETIME
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeDatetimeModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeEmailModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.String
  @Expose() override format: AttributeFormat = AttributeFormat.EMAIL
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeEmailModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeEnumModel extends AttributeModel {
  @Expose({ toClassOnly: true }) formatOptions: Attributes['formatOptions']

  @Expose() override type: AttributeType = AttributeType.String
  @Transform(({ obj }) => {
    return obj.formatOptions?.elements || []
  })
  @Expose()
  declare elements: string[]
  @Expose() override format: AttributeFormat = AttributeFormat.ENUM
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeEnumModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeFloatModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.Float
  @Expose()
  declare min: number | null
  @Expose()
  declare max: number | null
  @Expose() override default: number | null = null

  constructor(partial: Partial<AttributeFloatModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeIPModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.String
  @Expose() override format: AttributeFormat = AttributeFormat.IP
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeIPModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeIntegerModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.Integer
  @Expose()
  declare min: number | null
  @Expose()
  declare max: number | null
  @Expose() override default: number | null = null

  constructor(partial: Partial<AttributeIntegerModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeListModel extends AttributeModel {
  @Expose() total = 0
  @Expose() attributes: any[] = []

  constructor(partial: Partial<AttributeListModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeRelationshipModel extends AttributeModel {
  @Expose({ toClassOnly: true }) options: Attributes['options']

  @Transform(({ obj }) => {
    return obj.options?.relatedCollection || null
  })
  @Expose()
  declare relatedCollection: string | null
  @Transform(({ obj }) => {
    return obj.options?.relationType || RelationType.OneToOne
  })
  @Expose()
  declare relationType: RelationType
  @Transform(({ obj }) => {
    return obj.options?.twoWay || false
  })
  @Expose()
  declare twoWay: boolean
  @Transform(({ obj }) => {
    return obj.options?.twoWayKey
  })
  @Expose()
  declare twoWayKey: string | undefined
  @Transform(({ obj }) => {
    return obj.options?.onDelete || OnDelete.Restrict
  })
  @Expose()
  declare onDelete: OnDelete
  @Transform(({ obj }) => {
    return obj.options?.side || RelationSide.Parent
  })
  @Expose()
  declare side: RelationSide
  @Expose() override type: AttributeType = AttributeType.Relationship

  constructor(partial: Partial<AttributeRelationshipModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeStringModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.String
  @Expose() override size = 0
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeStringModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

@Exclude()
export class AttributeURLModel extends AttributeModel {
  @Expose() override type: AttributeType = AttributeType.String
  @Expose() override format: AttributeFormat = AttributeFormat.URL
  @Expose() override default: string | null = null

  constructor(partial: Partial<AttributeURLModel>) {
    super(partial)
    Object.assign(this, partial)
  }
}

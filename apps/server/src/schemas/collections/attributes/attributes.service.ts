import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Exception } from '@nuvix/core/extend/exception'
import { CollectionsHelper } from '@nuvix/core/helpers'
import {
  AttributeType,
  Database,
  Doc,
  DuplicateException,
  ID,
  LimitException,
  NumericType,
  Query,
  RangeValidator,
  RelationSide,
  RelationType,
  StructureValidator,
  TextValidator,
  TruncateException,
} from '@nuvix/db'
import {
  AttributeFormat,
  configuration,
  SchemaMeta,
  Status,
} from '@nuvix/utils'
import type {
  Attributes,
  AttributesDoc,
  CollectionsDoc,
} from '@nuvix/utils/types'
// DTOs
import type {
  CreateBooleanAttributeDTO,
  CreateDatetimeAttributeDTO,
  CreateEmailAttributeDTO,
  CreateEnumAttributeDTO,
  CreateFloatAttributeDTO,
  CreateIntegerAttributeDTO,
  CreateIpAttributeDTO,
  CreateRelationAttributeDTO,
  CreateStringAttributeDTO,
  CreateURLAttributeDTO,
  UpdateBooleanAttributeDTO,
  UpdateDatetimeAttributeDTO,
  UpdateEmailAttributeDTO,
  UpdateEnumAttributeDTO,
  UpdateFloatAttributeDTO,
  UpdateIntegerAttributeDTO,
  UpdateIpAttributeDTO,
  UpdateRelationAttributeDTO,
  UpdateStringAttributeDTO,
  UpdateURLAttributeDTO,
} from './DTO/attributes.dto'

@Injectable()
export class AttributesService {
  constructor(private readonly event: EventEmitter2) {}

  /**
   * Get attributes for a collection.
   */
  async getAttributes(
    db: Database,
    collectionId: string,
    queries: Query[] = [],
  ) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }
    queries.push(
      Query.equal('collectionInternalId', [collection.getSequence()]),
    )

    const filterQueries = Query.groupByType(queries).filters
    const attributes = await db.find(SchemaMeta.attributes, queries)
    const total = await db.count(
      SchemaMeta.attributes,
      filterQueries,
      configuration.limits.limitCount,
    )

    return {
      data: attributes,
      total,
    }
  }

  /**
   * Create string attribute.
   */
  async createStringAttribute(
    db: Database,
    collectionId: string,
    input: CreateStringAttributeDTO,
  ) {
    const { key, size, required, default: defaultValue, array, encrypt } = input

    const validator = new TextValidator(size, 0)
    if (defaultValue !== null && !validator.$valid(defaultValue)) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        validator.$description,
      )
    }

    const filters = []
    if (encrypt) {
      filters.push('encrypt')
    }

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.String,
      size,
      required,
      default: defaultValue,
      array,
      filters,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create email attribute.
   */
  async createEmailAttribute(
    db: Database,
    collectionId: string,
    input: CreateEmailAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array } = input

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.String,
      size: 254,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.EMAIL,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create enum attribute.
   */
  async createEnumAttribute(
    db: Database,
    collectionId: string,
    input: CreateEnumAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array, elements } = input

    if (defaultValue !== null && !elements?.includes(defaultValue)) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        'Default value not found in elements',
      )
    }

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.String,
      size: Database.LENGTH_KEY,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.ENUM,
      formatOptions: { elements },
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create IP attribute.
   */
  async createIPAttribute(
    db: Database,
    collectionId: string,
    input: CreateIpAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array } = input

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.String,
      size: 39,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.IP,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create URL attribute.
   */
  async createURLAttribute(
    db: Database,
    collectionId: string,
    input: CreateURLAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array } = input

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.String,
      size: 2000,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.URL,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create integer attribute.
   */
  async createIntegerAttribute(
    db: Database,
    collectionId: string,
    input: CreateIntegerAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array, min, max } = input

    const minValue = min ?? Number.MIN_SAFE_INTEGER
    const maxValue = max ?? Number.MAX_SAFE_INTEGER

    if (minValue > maxValue) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        'Minimum value must be lesser than maximum value',
      )
    }

    const validator = new RangeValidator(
      minValue,
      maxValue,
      NumericType.INTEGER,
    )

    if (defaultValue !== null && !validator.$valid(defaultValue)) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        validator.$description,
      )
    }

    const size = maxValue > 2147483647 ? 8 : 4 // Automatically create BigInt depending on max value

    let attribute = new Doc<Attributes>({
      key,
      type: AttributeType.Integer,
      size,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.INTEGER,
      formatOptions: {
        min: minValue,
        max: maxValue,
      },
    })

    attribute = await this.createAttribute(db, collectionId, attribute)

    const formatOptions = attribute.get('formatOptions', {})

    if (formatOptions) {
      attribute.set('min', Number.parseInt(formatOptions.min, 10))
      attribute.set('max', Number.parseInt(formatOptions.max, 10))
    }

    return attribute
  }

  /**
   * Create a float attribute.
   */
  async createFloatAttribute(
    db: Database,
    collectionId: string,
    input: CreateFloatAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array, min, max } = input

    const minValue = min ?? -Number.MAX_VALUE
    const maxValue = max ?? Number.MAX_VALUE

    if (minValue > maxValue) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        'Minimum value must be lesser than maximum value',
      )
    }

    const validator = new RangeValidator(minValue, maxValue, NumericType.FLOAT)

    if (defaultValue !== null && !validator.$valid(defaultValue)) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        validator.$description,
      )
    }

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.Float,
      size: 0,
      required,
      default: defaultValue,
      array,
      format: AttributeFormat.FLOAT,
      formatOptions: {
        min: minValue,
        max: maxValue,
      },
    })

    const createdAttribute = await this.createAttribute(
      db,
      collectionId,
      attribute,
    )

    const formatOptions = createdAttribute.get('formatOptions', {})

    if (formatOptions) {
      createdAttribute.set('min', Number.parseFloat(formatOptions.min))
      createdAttribute.set('max', Number.parseFloat(formatOptions.max))
    }

    return createdAttribute
  }

  /**
   * Create a boolean attribute.
   */
  async createBooleanAttribute(
    db: Database,
    collectionId: string,
    input: CreateBooleanAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array } = input

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.Boolean,
      size: 0,
      required,
      default: defaultValue,
      array,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create a date attribute.
   */
  async createDateAttribute(
    db: Database,
    collectionId: string,
    input: CreateDatetimeAttributeDTO,
  ) {
    const { key, required, default: defaultValue, array } = input

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.Timestamptz,
      size: 0,
      required,
      default: defaultValue,
      array,
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Create a relationship attribute.
   */
  async createRelationshipAttribute(
    db: Database,
    collectionId: string,
    input: CreateRelationAttributeDTO,
  ) {
    const { key, type, twoWay, twoWayKey, onDelete, relatedCollectionId } =
      input

    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )
    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const relatedCollectionDocument = await db.getDocument(
      SchemaMeta.collections,
      relatedCollectionId,
    )

    if (relatedCollectionDocument.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const relatedCollection = await db.getCollection(
      relatedCollectionDocument.getId(),
    )

    if (relatedCollection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const attributes = collection.get('attributes', []) as AttributesDoc[]

    for (const attribute of attributes) {
      if (attribute.get('type') !== AttributeType.Relationship) {
        continue
      }

      if (attribute.get('key').toLowerCase() === key.toLowerCase()) {
        throw new Exception(Exception.ATTRIBUTE_ALREADY_EXISTS)
      }

      if (
        attribute.get('options')?.twoWayKey?.toLowerCase() ===
          twoWayKey?.toLowerCase() &&
        attribute.get('options')?.relatedCollection ===
          relatedCollection.getId()
      ) {
        throw new Exception(
          Exception.ATTRIBUTE_ALREADY_EXISTS,
          'Attribute with the requested key already exists. Attribute keys must be unique, try again with a different key.',
        )
      }

      // TODO: in new lib its possible to create multiple many to many relationship attributes
      //  we have to review it later & remove the conditions
      if (
        type === RelationType.ManyToMany &&
        attribute.get('options')?.relationType === RelationType.ManyToMany &&
        attribute.get('options')?.relatedCollection ===
          relatedCollection.getId()
      ) {
        throw new Exception(
          Exception.ATTRIBUTE_ALREADY_EXISTS,
          'Creating more than one "manyToMany" relationship on the same collection is currently not permitted.',
        )
      }
    }

    const attribute = new Doc<Attributes>({
      key,
      type: AttributeType.Relationship,
      size: 0,
      required: false,
      default: null,
      array: false,
      filters: [],
      options: {
        relatedCollection: relatedCollectionId,
        relationType: type,
        twoWay: twoWay,
        twoWayKey: twoWayKey,
        onDelete: onDelete,
      },
    })

    return this.createAttribute(db, collectionId, attribute)
  }

  /**
   * Get an attribute.
   */
  async getAttribute(db: Database, collectionId: string, key: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const attribute = await db.getDocument(
      SchemaMeta.attributes,
      CollectionsHelper.getAttrId(collection.getSequence(), key),
    )

    if (attribute.empty()) {
      throw new Exception(Exception.ATTRIBUTE_NOT_FOUND)
    }

    const options = attribute.get('options', [])
    for (const [optionKey, option] of Object.entries(options)) {
      attribute.set(optionKey, option)
    }

    return attribute
  }

  /**
   * Update an string attribute.
   */
  async updateStringAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateStringAttributeDTO,
  ) {
    const { size, required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.String,
      size,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update email attribute.
   */
  async updateEmailAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateEmailAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.String,
      format: AttributeFormat.EMAIL,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update enum attribute.
   */
  async updateEnumAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateEnumAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey, elements } = input

    if (defaultValue !== null && !elements?.includes(defaultValue)) {
      throw new Exception(
        Exception.ATTRIBUTE_VALUE_INVALID,
        'Default value not found in elements',
      )
    }

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.String,
      format: AttributeFormat.ENUM,
      defaultValue,
      required,
      options: { elements },
      newKey,
    })
  }

  /**
   * Update IP attribute.
   */
  async updateIPAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateIpAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.String,
      format: AttributeFormat.IP,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update URL attribute.
   */
  async updateURLAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateURLAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.String,
      format: AttributeFormat.URL,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update integer attribute.
   */
  async updateIntegerAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateIntegerAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey, min, max } = input

    const attribute = await this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.Integer,
      defaultValue,
      required,
      options: { min, max },
      newKey,
    })

    const formatOptions = attribute.get('formatOptions', [])

    if (formatOptions) {
      attribute.set('min', Number.parseInt(formatOptions.min, 10))
      attribute.set('max', Number.parseInt(formatOptions.max, 10))
    }

    return attribute
  }

  /**
   * Update float attribute.
   */
  async updateFloatAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateFloatAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey, min, max } = input

    const attribute = await this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.Float,
      defaultValue,
      required,
      options: { min, max },
      newKey,
    })

    const formatOptions = attribute.get('formatOptions', [])

    if (formatOptions) {
      attribute.set('min', Number.parseFloat(formatOptions.min))
      attribute.set('max', Number.parseFloat(formatOptions.max))
    }

    return attribute
  }

  /**
   * Update boolean attribute.
   */
  async updateBooleanAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateBooleanAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.Boolean,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update date attribute.
   */
  async updateDateAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateDatetimeAttributeDTO,
  ) {
    const { required, default: defaultValue, newKey } = input

    return this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.Timestamptz,
      defaultValue,
      required,
      options: {},
      newKey,
    })
  }

  /**
   * Update relationship attribute.
   */
  async updateRelationshipAttribute(
    db: Database,
    collectionId: string,
    key: string,
    input: UpdateRelationAttributeDTO,
  ) {
    const { onDelete, newKey } = input

    const attribute = await this.updateAttribute({
      db,
      collectionId,
      key,
      type: AttributeType.Relationship,
      options: {
        onDelete: onDelete,
      },
      newKey,
    })

    const options = attribute.get('options', [])
    for (const [key, option] of Object.entries(options)) {
      attribute.set(key, option)
    }

    return attribute
  }

  /**
   * Create a new attribute.
   */
  async createAttribute(
    db: Database,
    collectionId: string,
    attribute: AttributesDoc,
  ) {
    const key = attribute.get('key')
    const type = attribute.get('type') as AttributeType
    const size = attribute.get('size', 0)
    const required = attribute.get('required', true)
    const array = attribute.get('array', false)
    const format = attribute.get('format', '')
    const formatOptions = attribute.get('formatOptions', {})
    const filters = attribute.get('filters', [])
    const defaultValue = attribute.get('default', null)
    const options = attribute.get('options', {})

    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    if (format && !StructureValidator.hasFormat(format, type)) {
      throw new Exception(
        Exception.ATTRIBUTE_FORMAT_UNSUPPORTED,
        `Format ${format} not available for ${type} attributes.`,
      )
    }

    if (required && defaultValue !== null) {
      throw new Exception(
        Exception.ATTRIBUTE_DEFAULT_UNSUPPORTED,
        'Cannot set default value for required attribute',
      )
    }

    if (array && defaultValue !== null) {
      throw new Exception(
        Exception.ATTRIBUTE_DEFAULT_UNSUPPORTED,
        'Cannot set default value for array attributes',
      )
    }

    let relatedCollection!: CollectionsDoc
    if (type === AttributeType.Relationship) {
      options.side = RelationSide.Parent
      relatedCollection = await db.getDocument(
        SchemaMeta.collections,
        options.relatedCollection ?? '',
      )
      if (relatedCollection.empty()) {
        throw new Exception(
          Exception.COLLECTION_NOT_FOUND,
          'The related collection was not found.',
        )
      }
    }

    try {
      const newAttribute = new Doc<Attributes>({
        $id: CollectionsHelper.getAttrId(collection.getSequence(), key),
        key,
        collectionInternalId: collection.getSequence(),
        collectionId,
        type,
        status: Status.PENDING,
        size,
        required,
        default: defaultValue,
        array,
        format,
        formatOptions,
        filters,
        options,
      })

      db.checkAttribute(collection as any, newAttribute as any)
      attribute = await db.createDocument(SchemaMeta.attributes, newAttribute)
    } catch (error) {
      if (error instanceof DuplicateException) {
        throw new Exception(Exception.ATTRIBUTE_ALREADY_EXISTS)
      }
      if (error instanceof LimitException) {
        throw new Exception(
          Exception.ATTRIBUTE_LIMIT_EXCEEDED,
          'Attribute limit exceeded',
        )
      }
      throw error
    }

    db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    db.purgeCachedCollection(collection.getId())

    if (type === AttributeType.Relationship && options.twoWay) {
      const twoWayKey = options.twoWayKey
      options.relatedCollection = collection.getId()
      options.twoWayKey = key
      options.side = RelationSide.Child

      try {
        const twoWayAttribute = new Doc<Attributes>({
          $id: ID.custom(
            CollectionsHelper.getRelatedAttrId(
              relatedCollection.getSequence(),
              twoWayKey,
            ),
          ),
          key: twoWayKey,
          collectionInternalId: relatedCollection.getSequence(),
          collectionId: relatedCollection.getId(),
          type,
          status: Status.AVAILABLE, // Set two way attribute as available directly since both attributes will be created in the same request
          size,
          required,
          default: defaultValue,
          array,
          format,
          formatOptions,
          filters,
          options,
        })

        db.checkAttribute(relatedCollection as any, twoWayAttribute as any)
        await db.createDocument(SchemaMeta.attributes, twoWayAttribute)
      } catch (error) {
        await db.deleteDocument(SchemaMeta.attributes, attribute.getId())
        if (error instanceof DuplicateException) {
          throw new Exception(Exception.ATTRIBUTE_ALREADY_EXISTS)
        }
        if (error instanceof LimitException) {
          throw new Exception(
            Exception.ATTRIBUTE_LIMIT_EXCEEDED,
            'Attribute limit exceeded',
          )
        }
        throw error
      }

      db.purgeCachedDocument(SchemaMeta.collections, relatedCollection.getId())
      db.purgeCachedCollection(relatedCollection.getId())
    }

    await CollectionsHelper.createAttribute({
      db,
      collection,
      attribute,
    }).catch(async error => {
      await db.deleteDocument(SchemaMeta.attributes, attribute.getId())
      if (type === AttributeType.Relationship && options.twoWay) {
        await db.deleteDocument(
          SchemaMeta.attributes,
          CollectionsHelper.getRelatedAttrId(
            relatedCollection.getSequence(),
            options.twoWayKey,
          ),
        )
      }
      throw error
    })

    return attribute
  }

  /**
   * Update an attribute.
   */
  async updateAttribute({
    db,
    collectionId,
    key,
    type,
    size,
    format,
    defaultValue,
    required,
    min,
    max,
    elements,
    options = {},
    newKey,
  }: {
    db: Database
    collectionId: string
    key: string
    type: string
    size?: number
    format?: string
    defaultValue?: string | boolean | number | null
    required?: boolean
    min?: number
    max?: number
    elements?: string[]
    options: Record<string, any>
    newKey?: string
  }) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    let attribute = await db.getDocument(
      SchemaMeta.attributes,
      CollectionsHelper.getAttrId(collection.getSequence(), key),
    )

    if (attribute.empty()) {
      throw new Exception(Exception.ATTRIBUTE_NOT_FOUND)
    }

    if (attribute.get('status') !== Status.AVAILABLE) {
      throw new Exception(Exception.ATTRIBUTE_NOT_AVAILABLE)
    }

    if (attribute.get('type') !== type) {
      throw new Exception(Exception.ATTRIBUTE_TYPE_INVALID)
    }

    if (
      attribute.get('type') === AttributeType.String &&
      format &&
      attribute.get('format') !== format
    ) {
      throw new Exception(Exception.ATTRIBUTE_TYPE_INVALID)
    }

    if (required && defaultValue !== undefined && defaultValue !== null) {
      throw new Exception(
        Exception.ATTRIBUTE_DEFAULT_UNSUPPORTED,
        'Cannot set default value for required attribute',
      )
    }

    if (
      attribute.get('array', false) &&
      defaultValue !== undefined &&
      defaultValue !== null
    ) {
      throw new Exception(
        Exception.ATTRIBUTE_DEFAULT_UNSUPPORTED,
        'Cannot set default value for array attributes',
      )
    }

    attribute.set('default', defaultValue).set('required', required)

    if (size !== undefined && size !== null) {
      attribute.set('size', size)
    }

    switch (attribute.get('format')) {
      case AttributeFormat.INTEGER:
      case AttributeFormat.FLOAT:
        if (
          min !== undefined &&
          max !== undefined &&
          min !== null &&
          max !== null
        ) {
          if (min > max) {
            throw new Exception(
              Exception.ATTRIBUTE_VALUE_INVALID,
              'Minimum value must be lesser than maximum value',
            )
          }

          const validator =
            attribute.get('format') === AttributeFormat.INTEGER
              ? new RangeValidator(min, max, NumericType.INTEGER)
              : new RangeValidator(min, max, NumericType.FLOAT)

          if (defaultValue !== undefined && !validator.$valid(defaultValue)) {
            throw new Exception(
              Exception.ATTRIBUTE_VALUE_INVALID,
              validator.$description,
            )
          }

          options = { min, max }
          attribute.set('formatOptions', options)
        }
        break
      case AttributeFormat.ENUM:
        if (!elements || elements.length === 0) {
          throw new Exception(
            Exception.ATTRIBUTE_VALUE_INVALID,
            'Enum elements must not be empty',
          )
        }

        for (const element of elements) {
          if (element.length === 0) {
            throw new Exception(
              Exception.ATTRIBUTE_VALUE_INVALID,
              'Each enum element must not be empty',
            )
          }
        }

        if (
          (defaultValue ?? null) !== null &&
          !elements.includes(defaultValue as any)
        ) {
          throw new Exception(
            Exception.ATTRIBUTE_VALUE_INVALID,
            'Default value not found in elements',
          )
        }

        options = { elements }
        attribute.set('formatOptions', options)
        break
    }

    if (type === AttributeType.Relationship) {
      const primaryDocumentOptions = {
        ...attribute.get('options', {}),
        ...options,
      }
      attribute.set('options', primaryDocumentOptions)

      await db.updateRelationship({
        collectionId: collection.getId(),
        id: key,
        newKey,
        onDelete: primaryDocumentOptions.onDelete,
      })

      if (primaryDocumentOptions.twoWay) {
        const relatedCollection = await db.getDocument(
          SchemaMeta.collections,
          primaryDocumentOptions.relatedCollection,
        )

        const relatedAttribute = await db.getDocument(
          SchemaMeta.attributes,
          CollectionsHelper.getRelatedAttrId(
            relatedCollection.getSequence(),
            primaryDocumentOptions.twoWayKey,
          ),
        )

        if (newKey && newKey !== key) {
          options.twoWayKey = newKey
        }

        const relatedOptions = {
          ...relatedAttribute.get('options'),
          ...options,
        }
        relatedAttribute.set('options', relatedOptions)
        await db.updateDocument(
          SchemaMeta.attributes,
          relatedAttribute.getId(),
          relatedAttribute,
        )

        db.purgeCachedDocument(
          SchemaMeta.collections,
          relatedCollection.getId(),
        )
      }
    } else {
      try {
        await db.updateAttribute(collection.getId(), key, {
          size,
          type: type as AttributeType,
          required,
          default: defaultValue,
          formatOptions: options,
          newKey,
        })
      } catch (error) {
        if (error instanceof TruncateException) {
          throw new Exception(Exception.ATTRIBUTE_INVALID_RESIZE)
        }
        throw error
      }
    }

    if (newKey && key !== newKey) {
      const original = attribute.clone()

      await db.deleteDocument(SchemaMeta.attributes, attribute.getId())

      attribute
        .set(
          '$id',
          CollectionsHelper.getAttrId(collection.getSequence(), newKey),
        )
        .set('key', newKey)

      try {
        attribute = await db.createDocument(SchemaMeta.attributes, attribute)
      } catch {
        attribute = await db.createDocument(SchemaMeta.attributes, original)
      }
    } else {
      attribute = await db.updateDocument(
        SchemaMeta.attributes,
        CollectionsHelper.getAttrId(collection.getSequence(), key),
        attribute,
      )
    }

    db.purgeCachedDocument(SchemaMeta.collections, collection.getId())

    this.event.emit(
      `schema.${db.schema}.collection.${collectionId}.attribute.${key}.updated`,
      attribute.toObject(),
    )

    return attribute
  }

  /**
   * Delete an attribute.
   */
  async deleteAttribute(db: Database, collectionId: string, key: string) {
    const collection = await db.getDocument(
      SchemaMeta.collections,
      collectionId,
    )

    if (collection.empty()) {
      throw new Exception(Exception.COLLECTION_NOT_FOUND)
    }

    const attribute = await db.getDocument(
      SchemaMeta.attributes,
      CollectionsHelper.getAttrId(collection.getSequence(), key),
    )

    if (attribute.empty()) {
      throw new Exception(Exception.ATTRIBUTE_NOT_FOUND)
    }

    // Only update status if removing available attribute
    // if (attribute.get('status') === Status.AVAILABLE) {
    //   await db.updateDocument(
    //     SchemaMeta.attributes,
    //     attribute.getId(),
    //     attribute.set('status', Status.DELETING),
    //   )
    // }

    db.purgeCachedDocument(SchemaMeta.collections, collectionId)
    db.purgeCachedCollection(collection.getId())

    if (attribute.get('type') === AttributeType.Relationship) {
      const options = attribute.get('options')
      if (options.twoWay) {
        const relatedCollection = await db.getDocument(
          SchemaMeta.collections,
          options.relatedCollection,
        )

        if (relatedCollection.empty()) {
          throw new Exception(Exception.COLLECTION_NOT_FOUND)
        }

        const relatedAttribute = await db.getDocument(
          SchemaMeta.attributes,
          CollectionsHelper.getRelatedAttrId(
            relatedCollection.getSequence(),
            options.twoWayKey,
          ),
        )
        if (relatedAttribute.empty()) {
          throw new Exception(Exception.ATTRIBUTE_NOT_FOUND)
        }

        // if (relatedAttribute.get('status') === Status.AVAILABLE) {
        //   await db.updateDocument(
        //     SchemaMeta.attributes,
        //     relatedAttribute.getId(),
        //     relatedAttribute.set('status', Status.DELETING),
        //   )
        // }

        db.purgeCachedDocument(
          SchemaMeta.collections,
          options.relatedCollection,
        )
        db.purgeCachedCollection(relatedCollection.getId())
      }
    }

    await CollectionsHelper.deleteAttribute({
      db,
      collection,
      attribute,
    })

    return
  }
}

import {
  AttributeType,
  RelationOptions,
  RelationSide,
  RelationType,
} from '@nuvix/db'
import { AttributeFormat, Schema } from '@nuvix/utils'
import type { AttributesDoc, CollectionsDoc } from '@nuvix/utils/types'
import prettier from 'prettier'
import type { GeneratorMetadata } from '../lib/generators'
import type {
  PostgresColumn,
  PostgresFunction,
  PostgresSchema,
  PostgresTable,
  PostgresType,
  PostgresView,
} from '../lib/index'

export const apply = async ({
  schemas,
  tables,
  foreignTables,
  views,
  materializedViews,
  columns,
  relationships,
  functions,
  types,
  detectOneToOneRelationships,
  schemasWithCollections,
  schemasMeta,
}: GeneratorMetadata & {
  detectOneToOneRelationships: boolean
  schemasWithCollections: Record<string, CollectionsDoc[]>
  schemasMeta: Schema[]
}): Promise<string> => {
  const columnsByTableId = Object.fromEntries<PostgresColumn[]>(
    [...tables, ...foreignTables, ...views, ...materializedViews].map(t => [
      t.id,
      [],
    ]),
  )
  columns
    .filter(c => c.table_id in columnsByTableId)
    .sort(({ name: a }, { name: b }) => a.localeCompare(b))
    .forEach(c => columnsByTableId[c.table_id]?.push(c))

  let output = `
import { Models } from '@nuvix/client'

// For more information on how to use these types, please refer to the documentation.
// https://docs.nuvix.in/products/database/api/generating-typescript-types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type Rel<S extends keyof Database, C extends keyof Database[S]['Types']> =
  Database[S]['Types'][C];

export type SchemaOf<S extends keyof Database> = Database[S]
export type TypesOf<S extends keyof Database> = SchemaOf<S>['Types']

export type Database = {
  ${Object.entries(schemasWithCollections).map(([s, collections]) => {
    return `${JSON.stringify(s)}: {
        __type: 'document';
        Types: {
          ${collections.length === 0 ? '[_ in never]: never' : generateDocSchemaTypes(collections)}
        }
        Enums: {
          ${generateDocSchemaEnums(collections)}
        } 
      }`
  })}
  ${schemas
    .sort(({ name: a }, { name: b }) => a.localeCompare(b))
    .map(schema => {
      const schemaTables = [...tables, ...foreignTables]
        .filter(table => table.schema === schema.name)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      const schemaViews = [...views, ...materializedViews]
        .filter(view => view.schema === schema.name)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      const schemaFunctions = functions
        .filter(func => {
          if (func.schema !== schema.name) {
            return false
          }

          // Either:
          // 1. All input args are be named, or
          // 2. There is only one input arg which is unnamed
          const inArgs = func.args.filter(({ mode }) =>
            ['in', 'inout', 'variadic'].includes(mode),
          )

          if (!inArgs.some(({ name }) => name === '')) {
            return true
          }

          if (inArgs.length === 1) {
            return true
          }

          return false
        })
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      const schemaEnums = types
        .filter(type => type.schema === schema.name && type.enums.length > 0)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      const schemaCompositeTypes = types
        .filter(
          type => type.schema === schema.name && type.attributes.length > 0,
        )
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      return `${JSON.stringify(schema.name)}: {
          __type: ${JSON.stringify(schemasMeta.find(s => s.name === schema.name)?.type ?? 'unknown')};
          Types: {
            Tables: {
              ${
                schemaTables.length === 0
                  ? '[_ in never]: never'
                  : schemaTables.map(
                      table => `${JSON.stringify(table.name)}: {
                  Row: {
                    ${[
                      ...(columnsByTableId[table.id] ?? []).map(
                        column =>
                          `${JSON.stringify(column.name)}: ${pgTypeToTsType(
                            column.format,
                            {
                              types,
                              schemas,
                              tables,
                              views,
                            },
                          )} ${column.is_nullable ? '| null' : ''}`,
                      ),
                      ...schemaFunctions
                        .filter(fn => fn.argument_types === table.name)
                        .map(fn => {
                          const type = types.find(
                            ({ id }) => id === fn.return_type_id,
                          )
                          let tsType = 'unknown'
                          if (type) {
                            tsType = pgTypeToTsType(type.name, {
                              types,
                              schemas,
                              tables,
                              views,
                            })
                          }
                          return `${JSON.stringify(fn.name)}: ${tsType} | null`
                        }),
                    ]}
                  }
                  Insert: {
                    ${columnsByTableId[table.id]?.map(column => {
                      let output = JSON.stringify(column.name)

                      if (column.identity_generation === 'ALWAYS') {
                        return `${output}?: never`
                      }

                      if (
                        column.is_nullable ||
                        column.is_identity ||
                        column.default_value !== null
                      ) {
                        output += '?:'
                      } else {
                        output += ':'
                      }

                      output += pgTypeToTsType(column.format, {
                        types,
                        schemas,
                        tables,
                        views,
                      })

                      if (column.is_nullable) {
                        output += '| null'
                      }

                      return output
                    })}
                  }
                  Update: {
                    ${columnsByTableId[table.id]?.map(column => {
                      let output = JSON.stringify(column.name)

                      if (column.identity_generation === 'ALWAYS') {
                        return `${output}?: never`
                      }

                      output += `?: ${pgTypeToTsType(column.format, { types, schemas, tables, views })}`

                      if (column.is_nullable) {
                        output += '| null'
                      }

                      return output
                    })}
                  }
                  Relationships: [
                    ${relationships
                      .filter(
                        relationship =>
                          relationship.schema === table.schema &&
                          relationship.referenced_schema === table.schema &&
                          relationship.relation === table.name,
                      )
                      .sort(
                        (a, b) =>
                          a.foreign_key_name.localeCompare(
                            b.foreign_key_name,
                          ) ||
                          a.referenced_relation.localeCompare(
                            b.referenced_relation,
                          ) ||
                          JSON.stringify(a.referenced_columns).localeCompare(
                            JSON.stringify(b.referenced_columns),
                          ),
                      )
                      .map(
                        relationship => `{
                        foreignKeyName: ${JSON.stringify(relationship.foreign_key_name)}
                        columns: ${JSON.stringify(relationship.columns)}
                        ${
                          detectOneToOneRelationships
                            ? `isOneToOne: ${relationship.is_one_to_one};`
                            : ''
                        }referencedRelation: ${JSON.stringify(relationship.referenced_relation)}
                        referencedColumns: ${JSON.stringify(relationship.referenced_columns)}
                      }`,
                      )}
                  ]
                }`,
                    )
              }
            }
            Views: {
              ${
                schemaViews.length === 0
                  ? '[_ in never]: never'
                  : schemaViews.map(
                      view => `${JSON.stringify(view.name)}: {
                  Row: {
                    ${columnsByTableId[view.id]?.map(
                      column =>
                        `${JSON.stringify(column.name)}: ${pgTypeToTsType(
                          column.format,
                          {
                            types,
                            schemas,
                            tables,
                            views,
                          },
                        )} ${column.is_nullable ? '| null' : ''}`,
                    )}
                  }
                  ${
                    'is_updatable' in view && view.is_updatable
                      ? `Insert: {
                           ${columnsByTableId[view.id]?.map(column => {
                             let output = JSON.stringify(column.name)

                             if (!column.is_updatable) {
                               return `${output}?: never`
                             }

                             output += `?: ${pgTypeToTsType(column.format, { types, schemas, tables, views })} | null`

                             return output
                           })}
                         }
                         Update: {
                           ${columnsByTableId[view.id]?.map(column => {
                             let output = JSON.stringify(column.name)

                             if (!column.is_updatable) {
                               return `${output}?: never`
                             }

                             output += `?: ${pgTypeToTsType(column.format, { types, schemas, tables, views })} | null`

                             return output
                           })}
                         }
                        `
                      : ''
                  }Relationships: [
                    ${relationships
                      .filter(
                        relationship =>
                          relationship.schema === view.schema &&
                          relationship.referenced_schema === view.schema &&
                          relationship.relation === view.name,
                      )
                      .sort(
                        (a, b) =>
                          a.foreign_key_name.localeCompare(
                            b.foreign_key_name,
                          ) ||
                          a.referenced_relation.localeCompare(
                            b.referenced_relation,
                          ) ||
                          JSON.stringify(a.referenced_columns).localeCompare(
                            JSON.stringify(b.referenced_columns),
                          ),
                      )
                      .map(
                        relationship => `{
                        foreignKeyName: ${JSON.stringify(relationship.foreign_key_name)}
                        columns: ${JSON.stringify(relationship.columns)}
                        ${
                          detectOneToOneRelationships
                            ? `isOneToOne: ${relationship.is_one_to_one};`
                            : ''
                        }referencedRelation: ${JSON.stringify(relationship.referenced_relation)}
                        referencedColumns: ${JSON.stringify(relationship.referenced_columns)}
                      }`,
                      )}
                  ]
                }`,
                    )
              }
            }
            Functions: {
              ${(() => {
                if (schemaFunctions.length === 0) {
                  return '[_ in never]: never'
                }

                const schemaFunctionsGroupedByName = schemaFunctions.reduce(
                  (acc, curr) => {
                    acc[curr.name] ??= []
                    acc[curr.name]?.push(curr)
                    return acc
                  },
                  {} as Record<string, PostgresFunction[]>,
                )

                return Object.entries(schemaFunctionsGroupedByName).map(
                  ([fnName, fns]) =>
                    `${JSON.stringify(fnName)}: {
                      Args: ${fns
                        .map(({ args }) => {
                          const inArgs = args.filter(
                            ({ mode }) => mode === 'in',
                          )

                          if (inArgs.length === 0) {
                            return 'Record<PropertyKey, never>'
                          }

                          const argsNameAndType = inArgs.map(
                            ({ name, type_id, has_default }) => {
                              const type = types.find(
                                ({ id }) => id === type_id,
                              )
                              let tsType = 'unknown'
                              if (type) {
                                tsType = pgTypeToTsType(type.name, {
                                  types,
                                  schemas,
                                  tables,
                                  views,
                                })
                              }
                              return { name, type: tsType, has_default }
                            },
                          )
                          return `{ ${argsNameAndType.map(({ name, type, has_default }) => `${JSON.stringify(name)}${has_default ? '?' : ''}: ${type}`)} }`
                        })
                        .toSorted()
                        // A function can have multiples definitions with differents args, but will always return the same type
                        .join(' | ')}
                      Returns: ${(() => {
                        // Case 1: `returns table`.
                        const tableArgs =
                          fns[0]?.args.filter(({ mode }) => mode === 'table') ??
                          []
                        if (tableArgs.length > 0) {
                          const argsNameAndType = tableArgs.map(
                            ({ name, type_id }) => {
                              const type = types.find(
                                ({ id }) => id === type_id,
                              )
                              let tsType = 'unknown'
                              if (type) {
                                tsType = pgTypeToTsType(type.name, {
                                  types,
                                  schemas,
                                  tables,
                                  views,
                                })
                              }
                              return { name, type: tsType }
                            },
                          )

                          return `{
                            ${argsNameAndType.map(
                              ({ name, type }) =>
                                `${JSON.stringify(name)}: ${type}`,
                            )}
                          }`
                        }

                        // Case 2: returns a relation's row type.
                        const relation = [...tables, ...views].find(
                          ({ id }) => id === fns[0]?.return_type_relation_id,
                        )
                        if (relation) {
                          return `{
                            ${columnsByTableId[relation.id]?.map(
                              column =>
                                `${JSON.stringify(column.name)}: ${pgTypeToTsType(
                                  column.format,
                                  {
                                    types,
                                    schemas,
                                    tables,
                                    views,
                                  },
                                )} ${column.is_nullable ? '| null' : ''}`,
                            )}
                          }`
                        }

                        // Case 3: returns base/array/composite/enum type.
                        const type = types.find(
                          ({ id }) => id === fns[0]?.return_type_id,
                        )
                        if (type) {
                          return pgTypeToTsType(type.name, {
                            types,
                            schemas,
                            tables,
                            views,
                          })
                        }

                        return 'unknown'
                      })()}${fns[0]?.is_set_returning_function ? '[]' : ''}
                    }`,
                )
              })()}
            }
            Enums: {
              ${
                schemaEnums.length === 0
                  ? '[_ in never]: never'
                  : schemaEnums.map(
                      enum_ =>
                        `${JSON.stringify(enum_.name)}: ${enum_.enums
                          .map(variant => JSON.stringify(variant))
                          .join('|')}`,
                    )
              }
            }
            CompositeTypes: {
              ${
                schemaCompositeTypes.length === 0
                  ? '[_ in never]: never'
                  : schemaCompositeTypes.map(
                      ({ name, attributes }) =>
                        `${JSON.stringify(name)}: {
                        ${attributes.map(({ name, type_id }) => {
                          const type = types.find(({ id }) => id === type_id)
                          let tsType = 'unknown'
                          if (type) {
                            tsType = `${pgTypeToTsType(type.name, { types, schemas, tables, views })} | null`
                          }
                          return `${JSON.stringify(name)}: ${tsType}`
                        })}
                      }`,
                    )
              }
            }
          }
        }`
    })}
}

${
  // type DefaultSchema = Database[Extract<keyof Database, ${JSON.stringify(GENERATE_TYPES_DEFAULT_SCHEMA)}>]
  // export type Tables<
  //   DefaultSchemaTableNameOrOptions extends
  //     | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  //     | { schema: keyof Database },
  //   TableName extends DefaultSchemaTableNameOrOptions extends {
  //     schema: keyof Database
  //   }
  //     ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
  //         Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  //     : never = never,
  // > = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  //   ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
  //       Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
  //       Row: infer R
  //     }
  //     ? R
  //     : never
  //   : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
  //         DefaultSchema["Views"])
  //     ? (DefaultSchema["Tables"] &
  //         DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
  //         Row: infer R
  //       }
  //       ? R
  //       : never
  //     : never

  // export type TablesInsert<
  //   DefaultSchemaTableNameOrOptions extends
  //     | keyof DefaultSchema["Tables"]
  //     | { schema: keyof Database },
  //   TableName extends DefaultSchemaTableNameOrOptions extends {
  //     schema: keyof Database
  //   }
  //     ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  //     : never = never,
  // > = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  //   ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
  //       Insert: infer I
  //     }
  //     ? I
  //     : never
  //   : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  //     ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
  //         Insert: infer I
  //       }
  //       ? I
  //       : never
  //     : never

  // export type TablesUpdate<
  //   DefaultSchemaTableNameOrOptions extends
  //     | keyof DefaultSchema["Tables"]
  //     | { schema: keyof Database },
  //   TableName extends DefaultSchemaTableNameOrOptions extends {
  //     schema: keyof Database
  //   }
  //     ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  //     : never = never,
  // > = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  //   ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
  //       Update: infer U
  //     }
  //     ? U
  //     : never
  //   : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  //     ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
  //         Update: infer U
  //       }
  //       ? U
  //       : never
  //     : never

  // export type Enums<
  //   DefaultSchemaEnumNameOrOptions extends
  //     | keyof DefaultSchema["Enums"]
  //     | { schema: keyof Database },
  //   EnumName extends DefaultSchemaEnumNameOrOptions extends {
  //     schema: keyof Database
  //   }
  //     ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  //     : never = never,
  // > = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  //   ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  //   : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  //     ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  //     : never

  // export type CompositeTypes<
  //   PublicCompositeTypeNameOrOptions extends
  //     | keyof DefaultSchema["CompositeTypes"]
  //     | { schema: keyof Database },
  //   CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
  //     schema: keyof Database
  //   }
  //     ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  //     : never = never,
  // > = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  //   ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  //   : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  //     ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  //     : never
  ''
}
export const Constants = {
  ${schemas
    .sort(({ name: a }, { name: b }) => a.localeCompare(b))
    .map(schema => {
      const schemaEnums = types
        .filter(type => type.schema === schema.name && type.enums.length > 0)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
      return `${JSON.stringify(schema.name)}: {
          Enums: {
            ${schemaEnums.map(
              enum_ =>
                `${JSON.stringify(enum_.name)}: [${enum_.enums
                  .map(variant => JSON.stringify(variant))
                  .join(', ')}]`,
            )}
          }
        }`
    })},
      ${Object.entries(schemasWithCollections)
        .map(([schemaName, collections]) => {
          const docEnums = generateDocSchemaConstants(collections)
          return `${JSON.stringify(schemaName)}: {
      Enums: {
        ${docEnums}
      }
    }`
        })
        .join(',\n')}
} as const
`

  output = await prettier.format(output, {
    parser: 'typescript',
    semi: false,
  })
  return output
}

/* -----------------------
   Type generation helpers
   ----------------------- */

/**
 * Convert Postgres types to TS types (unchanged behavior)
 */
const pgTypeToTsType = (
  pgType: string,
  {
    types,
    schemas,
    tables,
    views,
  }: {
    types: PostgresType[]
    schemas: PostgresSchema[]
    tables: PostgresTable[]
    views: PostgresView[]
  },
): string => {
  if (pgType === 'bool') {
    return 'boolean'
  }
  if (
    ['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].includes(pgType)
  ) {
    return 'number'
  }
  if (
    [
      'bytea',
      'bpchar',
      'varchar',
      'date',
      'text',
      'citext',
      'time',
      'timetz',
      'timestamp',
      'timestamptz',
      'uuid',
      'vector',
    ].includes(pgType)
  ) {
    return 'string'
  }
  if (['json', 'jsonb'].includes(pgType)) {
    return 'Json'
  }
  if (pgType === 'void') {
    return 'undefined'
  }
  if (pgType === 'record') {
    return 'Record<string, unknown>'
  }
  if (pgType.startsWith('_')) {
    return `(${pgTypeToTsType(pgType.substring(1), { types, schemas, tables, views })})[]`
  }
  const enumType = types.find(
    type => type.name === pgType && type.enums.length > 0,
  )
  if (enumType) {
    if (schemas.some(({ name }) => name === enumType.schema)) {
      return `Database[${JSON.stringify(enumType.schema)}]['Enums'][${JSON.stringify(
        enumType.name,
      )}]`
    }
    return enumType.enums.map(variant => JSON.stringify(variant)).join('|')
  }

  const compositeType = types.find(
    type => type.name === pgType && type.attributes.length > 0,
  )
  if (compositeType) {
    if (schemas.some(({ name }) => name === compositeType.schema)) {
      return `Database[${JSON.stringify(
        compositeType.schema,
      )}]['CompositeTypes'][${JSON.stringify(compositeType.name)}]`
    }
    return 'unknown'
  }

  const tableRowType = tables.find(table => table.name === pgType)
  if (tableRowType) {
    if (schemas.some(({ name }) => name === tableRowType.schema)) {
      return `Database[${JSON.stringify(tableRowType.schema)}]['Tables'][${JSON.stringify(
        tableRowType.name,
      )}]['Row']`
    }
    return 'unknown'
  }

  const viewRowType = views.find(view => view.name === pgType)
  if (viewRowType) {
    if (schemas.some(({ name }) => name === viewRowType.schema)) {
      return `Database[${JSON.stringify(viewRowType.schema)}]['Views'][${JSON.stringify(
        viewRowType.name,
      )}]['Row']`
    }
    return 'unknown'
  }

  return 'unknown'
}

/* -----------------------
   Document schema generators
   ----------------------- */

/**
 * Normalize enum names to a consistent stable form
 */
const normalizeEnumName = (collectionId: string, key: string) =>
  `${collectionId}_${key}`.replace(/[^a-zA-Z0-9_]/g, '_')

/**
 * Generate Types block for document schema collections.
 */
const generateDocSchemaTypes = (collections: CollectionsDoc[]): string => {
  if (collections.length === 0) {
    return '[_ in never]: never'
  }

  return collections
    .map(collection => {
      const attributes = collection.get('attributes') as AttributesDoc[]

      const fields = attributes
        .map(field => {
          const isOptional =
            !field.get('required') || Boolean(field.get('default'))
          const tsType =
            field.get('type') === AttributeType.Relationship
              ? relationshipTypeToTsType(collection.get('$schema'), field)
              : attributeTypeToTsType(field)

          return `${JSON.stringify(field.get('key'))}${isOptional ? '?' : ''}: ${tsType}`
        })
        .join('\n        ')

      const key = collection.get('$id')
      return `${JSON.stringify(key)}: {
        ${fields}
      } & Models.Document`
    })
    .join('\n\n          ')
}

/**
 * Build the Enums type mapping for a document schema.
 */
const generateDocSchemaEnums = (collections: CollectionsDoc[]): string => {
  const enumTypes = new Map<string, string[]>()

  // Collect all enum values from attributes with enum format
  collections.forEach(collection => {
    const attributes = collection.get('attributes') as AttributesDoc[]

    attributes.forEach(attribute => {
      if (
        attribute.get('format') === AttributeFormat.ENUM &&
        attribute.get('elements')
      ) {
        const elements = attribute.get('elements') as string[]
        const rawEnumName = normalizeEnumName(
          collection.get('$id'),
          attribute.get('key'),
        )
        enumTypes.set(rawEnumName, elements)
      }
    })
  })

  if (enumTypes.size === 0) {
    return '[_ in never]: never'
  }

  return Array.from(enumTypes.entries())
    .map(
      ([enumName, values]) =>
        `${JSON.stringify(enumName)}: ${values.map(v => JSON.stringify(v)).join(' | ')}`,
    )
    .join('\n        ')
}

/**
 * Build runtime Constants for document schema enums.
 */
const generateDocSchemaConstants = (collections: CollectionsDoc[]): string => {
  const enumTypes = new Map<string, string[]>()

  collections.forEach(collection => {
    const attributes = collection.get('attributes') as AttributesDoc[]

    attributes.forEach(attribute => {
      if (
        attribute.get('format') === AttributeFormat.ENUM &&
        attribute.get('elements')
      ) {
        const elements = attribute.get('elements') as string[]
        const rawEnumName = normalizeEnumName(
          collection.get('$id'),
          attribute.get('key'),
        )
        enumTypes.set(rawEnumName, elements)
      }
    })
  })

  if (enumTypes.size === 0) {
    return ''
  }

  return Array.from(enumTypes.entries())
    .map(
      ([enumName, values]) =>
        `${JSON.stringify(enumName)}: [${values.map(v => JSON.stringify(v)).join(', ')}]`,
    )
    .join(',\n        ')
}

const attributeTypeToTsType = (attribute: AttributesDoc): string => {
  const attributeType = attribute.get('type') as AttributeType
  const format = attribute.get('format') as AttributeFormat | undefined
  const isArray = Boolean(attribute.get('array'))
  const elements = attribute.get('elements') as string[] | undefined

  // Handle enum format
  if (format === AttributeFormat.ENUM && elements && elements.length) {
    const union = elements.map(el => JSON.stringify(el)).join(' | ')
    return isArray ? `Array<${union}>` : union
  }

  let baseType: string

  switch (attributeType) {
    case AttributeType.String:
      baseType = 'string'
      break
    case AttributeType.Integer:
    case AttributeType.Float:
      baseType = 'number'
      break
    case AttributeType.Boolean:
      baseType = 'boolean'
      break
    case AttributeType.Timestamptz:
      baseType = 'string'
      break
    default:
      baseType = 'unknown'
  }

  return isArray ? `Array<${baseType}>` : baseType
}

/**
 * Outputs: Array<Rel<'schema','collectionId'>> or Rel<'schema','collectionId'> | null
 */
const relationshipTypeToTsType = (
  schema: string,
  attribute: AttributesDoc,
): string => {
  const attr: any = attribute.getAll()

  const options = {
    side: attr.side as RelationSide,
    twoWay: attr.twoWay as boolean,
    onDelete: attr.onDelete as string,
    twoWayKey: attr.twoWayKey as string | null,
    relationType: attr.relationType as RelationType,
    relatedCollection: attr.relatedCollection as string,
  } as RelationOptions

  const relatedCollectionId = options.relatedCollection

  const baseType = `Rel<${JSON.stringify(schema)}, ${JSON.stringify(relatedCollectionId)}>`
  if (
    options.relationType === RelationType.ManyToMany ||
    (options.relationType === RelationType.OneToMany &&
      options.side === RelationSide.Child) ||
    (options.relationType === RelationType.ManyToOne &&
      options.side === RelationSide.Parent)
  ) {
    return `Array<${baseType}>`
  }
  return `${baseType} | null`
}

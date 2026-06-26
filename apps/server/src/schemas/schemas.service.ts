import { Injectable } from '@nestjs/common'
import { CoreService } from '@nuvix/core/core.service'
import { Exception } from '@nuvix/core/extend/exception'
import {
  Authorization,
  Database,
  Doc,
  PermissionsValidator,
  PermissionType,
} from '@nuvix/db'
import { DataSource, Raw } from '@nuvix/pg'
import { DatabaseRole } from '@nuvix/utils'
import { transformPgError } from '@nuvix/utils/database'
import { ASTToQueryBuilder } from '@nuvix/utils/query'
import {
  CallFunction,
  Count,
  Delete,
  GetPermissions,
  Insert,
  RestContext,
  Select,
  Update,
  UpdatePermissions,
  Upsert,
} from './schemas.types'

/**
 * Validate and sanitize a SQL identifier (table name, schema name, parameter name).
 * Rejects any identifier containing characters outside [a-zA-Z0-9_]
 * or that doesn't start with a letter or underscore.
 * Throws an Exception on invalid input to prevent SQL injection.
 */
function sanitizeIdentifier(identifier: string, label = 'identifier'): string {
  if (!identifier || typeof identifier !== 'string') {
    throw new Exception(Exception.INVALID_PARAMS, `Invalid ${label}: must be a non-empty string`)
  }
  // Only allow letters, digits, underscores; must start with letter or underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Exception(
      Exception.INVALID_PARAMS,
      `Invalid ${label}: "${identifier}" contains disallowed characters. Only alphanumeric characters and underscores are allowed.`,
    )
  }
  return identifier
}

@Injectable()
export class SchemasService {
  private readonly pg: DataSource
  private readonly dataSource: DataSource

  private static limit = 500

  constructor(private readonly coreService: CoreService) {
    this.dataSource = this.coreService.getDataSourceWithMainPool()
    this.pg = this.coreService.getDataSource()
  }

  async select({ table, schema, query, context }: Select) {
    const allowedSchemas = context.ctx.getExposedSchemas()
    const { limit, offset, filter, select, order } = query

    const qb = this.pg.table(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, { allowedSchemas })
    ast.applySelect(select)
    ast.applyFilters(filter, { applyExtra: true, tableName: table })
    ast.applyOrder(order, table)
    ast.applyLimitOffset({
      limit: limit ?? filter?.limit ?? SchemasService.limit,
      offset: offset ?? filter?.offset ?? 0,
    })

    return this.handleQuery(context, qb)
  }

  private async handleQuery<T>(
    context: RestContext,
    qb: ReturnType<DataSource['queryBuilder']>,
  ) {
    const { ctx } = context
    const { user, session } = ctx

    const roles = Authorization.getRoles() ?? []
    const role = user.empty() ? DatabaseRole.ANON : DatabaseRole.AUTHENTICATED

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(context.headers ?? {})) {
      if (v != null) headers[k.toLowerCase()] = String(v)
    }

    const userPayload =
      user && !user.empty()
        ? {
            id: user.getId(),
            name: user.get('name'),
            email: user.get('email'),
          }
        : null

    const sessionPayload = session
      ? {
          id: session.getId(),
          userId: session.get('userId'),
          provider: session.get('provider'),
          ip: session.get('ip'),
          userAgent: session.get('userAgent'),
        }
      : null

    // Use Postgres Arrays for roles {"any", "guests"}
    const roleLiteral =
      roles.length > 0
        ? `{${roles.map(r => `"${r.replace(/"/g, '\\"')}"`).join(',')}}`
        : '{}'

    // Execute config and main query in a single transaction batch
    return this.pg
      .transaction(async tx => {
        // Execute both config and query in the same transaction to ensure config is set for the query
        await tx.queryBuilder().select(
          tx.raw(
            `
            set_config('role', ?, true),
            set_config('request.method', ?, true),
            set_config('request.path', ?, true),
            set_config('request.id', ?, true),
            set_config('request.headers', ?, true),
            set_config('request.ip', ?, true),
            set_config('request.auth.user', ?, true),
            set_config('request.auth.session', ?, true),
            set_config('request.auth.roles', ?, true)
            `,
            [
              role,
              context.method.toUpperCase(),
              context.url ?? '',
              context.id ?? '',
              JSON.stringify(headers),
              context.ip ?? '',
              userPayload ?? '',
              sessionPayload ?? '',
              roleLiteral,
            ],
          ),
        )
        return qb.transacting(tx as any)
      })
      .catch(e => this.processError(e))
  }

  async insert({ table, input, schema, query, context }: Insert) {
    if (!input) {
      throw new Exception(
        Exception.INVALID_PARAMS,
        'Input data is required for insert operation',
      )
    }
    const isArrayData = Array.isArray(input)

    let data: Record<string, any> | Record<string, any>[]
    const { columns, select, onConflict, ignoreDuplicates } = query

    if (columns?.length) {
      if (isArrayData) {
        data = input.map(record =>
          columns.reduce(
            (acc, column) => {
              acc[column] = record[column]
              return acc
            },
            {} as Record<string, any>,
          ),
        )
      } else {
        data = columns.reduce(
          (acc, column) => {
            acc[column] = input[column]
            return acc
          },
          {} as Record<string, any>,
        )
      }
    } else {
      data = input
    }

    const qb = this.pg.qb(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, {
      allowedSchemas: context.ctx.getExposedSchemas(),
    })
    ast.applyReturning(select)
    qb.insert(data)

    if (onConflict?.length) {
      if (ignoreDuplicates) {
        qb.onConflict(onConflict).ignore()
      } else {
        qb.onConflict(onConflict).merge()
      }
    }

    return this.handleQuery(context, qb)
  }

  async upsert({ table, input, schema, query, context }: Upsert) {
    if (!input) {
      throw new Exception(
        Exception.INVALID_PARAMS,
        'Input data is required for upsert operation',
      )
    }
    const isArrayData = Array.isArray(input)

    let data: Record<string, any> | Record<string, any>[]
    const { columns, select, onConflict } = query

    if (columns?.length) {
      if (isArrayData) {
        data = (input as Record<string, any>[]).map(record =>
          columns.reduce(
            (acc, column) => {
              acc[column] = record[column]
              return acc
            },
            {} as Record<string, any>,
          ),
        )
      } else {
        data = columns.reduce(
          (acc, column) => {
            acc[column] = (input as Record<string, any>)[column]
            return acc
          },
          {} as Record<string, any>,
        )
      }
    } else {
      data = input
    }

    const qb = this.pg.qb(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, {
      allowedSchemas: context.ctx.getExposedSchemas(),
    })
    ast.applyReturning(select)
    qb.insert(data)

    if (onConflict?.length) {
      qb.onConflict(onConflict).merge()
    } else {
      qb.onConflict().ignore()
    }

    return this.handleQuery(context, qb)
  }

  async count({ table, schema, query, context }: Count): Promise<number> {
    const qb = this.pg.table(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, {
      allowedSchemas: context.ctx.getExposedSchemas(),
    })
    ast.applyFilters(query.filter, { applyExtra: false, tableName: table })
    qb.count('* as count')

    const result = (await this.handleQuery(context, qb)) as Array<{
      count: string | number
    }>
    return Number(result?.[0]?.count ?? 0)
  }

  async update({ table, input, query, schema, context }: Update) {
    if (!input) {
      throw new Exception(
        Exception.INVALID_PARAMS,
        'Input data is required for update operation',
      )
    }
    let data: Record<string, any> | Record<string, any>[]
    const { columns, filter, select, order, limit, offset, force } = query

    if (columns?.length) {
      data = columns.reduce(
        (acc, column) => {
          acc[column] = input[column]
          return acc
        },
        {} as Record<string, any>,
      )
    } else {
      data = input
    }

    const qb = this.pg.qb(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, {
      allowedSchemas: context.ctx.getExposedSchemas(),
    })
    ast.applyReturning(select)
    ast.applyFilters(filter, {
      applyExtra: true,
      tableName: table,
      throwOnEmpty: !force,
      throwOnEmptyError: new Exception(
        Exception.GENERAL_BAD_REQUEST,
        'you must provide a filter to update data or use &force=true',
      ),
    })
    ast.applyOrder(order, table)
    ast.applyLimitOffset({
      limit,
      offset,
    })
    qb.update(data)

    return this.handleQuery(context, qb)
  }

  async delete({
    table,
    schema,
    query: { filter, select, order, limit, offset, force },
    context,
  }: Delete) {
    const qb = this.pg.table(table).withSchema(schema)
    const ast = new ASTToQueryBuilder(qb, this.pg, {
      allowedSchemas: context.ctx.getExposedSchemas(),
    })

    ast.applyReturning(select)
    ast.applyFilters(filter, {
      applyExtra: true,
      tableName: table,
      throwOnEmpty: !force,
      throwOnEmptyError: new Exception(
        Exception.GENERAL_BAD_REQUEST,
        'you must provide a filter to delete data or use &force=true',
      ),
    })
    ast.applyOrder(order, table)
    ast.applyLimitOffset({
      limit,
      offset,
    })
    qb.delete()

    return this.handleQuery(context, qb)
  }

  async callFunction({
    functionName,
    schema,
    query: { limit, offset, select, filter, order },
    args,
    context,
  }: CallFunction) {
    // Sanitize SQL identifiers to prevent injection via crafted names
    sanitizeIdentifier(functionName, 'functionName')
    sanitizeIdentifier(schema, 'schema')

    let placeholder: string
    let values: any[]

    if (Array.isArray(args)) {
      // Handle array args (unnamed parameters)
      placeholder = args.map(() => '?').join(', ')
      values = [schema, functionName, ...args]
    } else {
      // Handle object args (named parameters)
      const _argNames = Object.keys(args || {})
      const _values = Object.values(args || {})
      // Sanitize parameter names to prevent SQL injection through crafted keys
      const safeArgNames = _argNames.map(n => sanitizeIdentifier(n, 'function parameter name'))
      placeholder = safeArgNames.map(n => `${n}:= ?`).join(', ')
      values = [schema, functionName, ..._values]
    }

    const raw = new Raw(this.pg)
    raw.set(`??.??(${placeholder})`, values)

    const qb = this.pg.queryBuilder().table(raw as any)
    const ast = new ASTToQueryBuilder(qb, this.pg)
    ast.applySelect(select)
    ast.applyFilters(filter)
    ast.applyOrder(order, functionName)
    ast.applyLimitOffset({
      limit,
      offset,
    })

    const result = await this.handleQuery(context, qb)

    if (
      Array.isArray(result) &&
      result.length === 1 &&
      functionName in result[0] &&
      Object.keys(result[0]).length === 1
    ) {
      return result[0][functionName]
    }
    return result
  }

  private processError(e: unknown): never {
    const error = transformPgError(e)
    if (!error || error.status >= 500) {
      throw new Exception(
        error?.type ?? Exception.GENERAL_SERVER_ERROR,
        error?.message ?? 'Database error',
        error?.status,
      )
    }
    throw new Exception(error.type, error.message, error.status).addDetails({
      hint: error.details.hint,
      detail: error.details.detail,
    })
  }

  async updatePermissions({
    tableId,
    schema,
    permissions,
    rowId,
  }: UpdatePermissions) {
    // Sanitize SQL identifiers to prevent injection via crafted table/schema names
    sanitizeIdentifier(tableId, 'tableId')
    sanitizeIdentifier(schema, 'schema')

    const allowed = [
      PermissionType.Read,
      PermissionType.Update,
      PermissionType.Delete,
    ]
    if (rowId === undefined || rowId === null) {
      allowed.push(PermissionType.Create)
    }

    const validator = new PermissionsValidator(undefined, allowed)
    if (!validator.$valid(permissions)) {
      throw new Exception(Exception.GENERAL_BAD_REQUEST, validator.$description)
    }

    const doc = new Doc({
      $permissions: permissions,
    })

    // Get current permissions from DB
    const query = this.dataSource
      .table(`${sanitizeIdentifier(tableId, 'tableId')}_perms`)
      .withSchema(schema)
      .select(['permission', 'roles'])

    if (rowId !== undefined && rowId !== null) {
      query.andWhere('row_id', rowId)
    } else {
      query.whereNull('row_id')
    }

    const rows = (await query) as unknown as Array<{
      permission: string
      roles: string[]
    }>

    const existingPermissions: Record<string, string[]> = {}
    for (const row of rows) {
      existingPermissions[row.permission] = Array.isArray(row.roles)
        ? row.roles
        : []
    }

    // Build operations for each permission type
    for (const type of Database.PERMISSIONS) {
      const newPermissions = doc.getPermissionsByType(type)
      const currentPermissions = existingPermissions[type] || []

      const hasChanged =
        JSON.stringify(newPermissions.sort()) !==
        JSON.stringify(currentPermissions.sort())

      if (!hasChanged) {
        continue
      }

      if (newPermissions.length === 0) {
        // Delete existing row
        if (currentPermissions.length > 0) {
          const delQuery = this.dataSource
            .table(`${sanitizeIdentifier(tableId, 'tableId')}_perms`)
            .withSchema(schema)
            .andWhere('permission', type)

          if (rowId !== undefined && rowId !== null) {
            delQuery.andWhere('row_id', rowId)
          } else {
            delQuery.whereNull('row_id')
          }

          await delQuery.delete()
        }
      } else if (currentPermissions.length > 0) {
        // Update existing row
        const updQuery = this.dataSource
          .table(`${sanitizeIdentifier(tableId, 'tableId')}_perms`)
          .withSchema(schema)
          .andWhere('permission', type)

        if (rowId !== undefined && rowId !== null) {
          updQuery.andWhere('row_id', rowId)
        } else {
          updQuery.whereNull('row_id')
        }

        await updQuery.update({
          roles: newPermissions,
        })
      } else {
        // Insert new row
        await this.dataSource
          .table(`${sanitizeIdentifier(tableId, 'tableId')}_perms`)
          .withSchema(schema)
          .insert({
            permission: type,
            roles: newPermissions,
            row_id: rowId ?? null,
          })
      }
    }

    return permissions
  }

  async getPermissions({
    tableId,
    rowId,
    schema,
  }: GetPermissions): Promise<string[]> {
    // Sanitize SQL identifiers to prevent injection
    sanitizeIdentifier(tableId, 'tableId')
    sanitizeIdentifier(schema, 'schema')

    const query = this.dataSource
      .table(`${sanitizeIdentifier(tableId, 'tableId')}_perms`)
      .withSchema(schema)
      .select(['roles', 'permission'])

    if (rowId !== undefined && rowId !== null) {
      query.andWhere('row_id', rowId)
    } else {
      query.whereNull('row_id')
    }

    const rows = (await query) as unknown as Array<{
      permission: string
      roles: string[]
    }>

    const result: string[] = []

    for (const row of rows) {
      const type = row.permission // e.g. "read" | "update" | "delete"
      const perms: string[] = Array.isArray(row.roles) ? row.roles : []

      for (const p of perms) {
        result.push(`${type}("${p}")`)
      }
    }

    return result
  }
}

// function applyContextToWith(
//   qb: ReturnType<DataSource['queryBuilder']>,
//   context: RestContext,
//   pg: any,
// ) {
//   const { ctx } = context
//   const { user, session } = ctx

//   const roles = Authorization.getRoles() ?? []

//   const headers: Record<string, string | string[]> = {}
//   for (const [k, v] of Object.entries(context.headers ?? {})) {
//     if (v != null) headers[k.toLowerCase()] = v
//   }

//   const userPayload =
//     user && !user.empty()
//       ? JSON.stringify({
//           id: user.getId(),
//           name: user.get('name'),
//           email: user.get('email'),
//         })
//       : undefined

//   const sessionPayload =
//     session && !session.empty()
//       ? JSON.stringify({
//           id: session.getId(),
//           userId: session.get('userId'),
//           provider: session.get('provider'),
//           ip: session.get('ip'),
//           userAgent: session.get('userAgent'),
//         })
//       : undefined

//   const roleLiteral =
//     roles.length > 0
//       ? `{${roles.map(r => `"${r.replace(/"/g, '\\"')}"`).join(',')}}`
//       : '{}'
//   const role =
//     user && !user.empty() ? DatabaseRole.AUTHENTICATED : DatabaseRole.ANON

//   qb.with('ctx', sub => {
//     sub.select(
//       pg.raw(
//         `
//         set_config('role', ?, true),
//         set_config('request.method', ?, true),
//         set_config('request.path', ?, true),
//         set_config('request.id', ?, true),
//         set_config('request.headers', ?, true),
//         set_config('request.ip', ?, true),
//         set_config('request.auth.user', ?, true),
//         set_config('request.auth.session', ?, true),
//         set_config('request.auth.roles', ?, true),
//         1 as d
//         `, // the "1 as d" is just a dummy select
//         [
//           role,
//           context.method.toUpperCase(),
//           context.url ?? '',
//           context.id ?? '',
//           JSON.stringify(headers),
//           context.ip ?? '',
//           userPayload ?? '',
//           sessionPayload ?? '',
//           roleLiteral,
//         ],
//       ),
//     )
//   })

//   return qb
// }

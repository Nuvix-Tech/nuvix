import {
  Body,
  Controller,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { Delete, Get, Patch, Post, Put } from '@nuvix/core'
import { AuthType, CurrentSchemaType, Namespace } from '@nuvix/core/decorators'
import { ApiInterceptor, SchemaGuard } from '@nuvix/core/resolvers'
import { SchemaType } from '@nuvix/utils'
import { PermissionsDTO } from './DTO/permissions.dto'
import {
  CallFunctionQueryDTO,
  CountQueryDTO,
  DeleteQueryDTO,
  FunctionParamsDTO,
  InsertQueryDTO,
  RowParamsDTO,
  SelectQueryDTO,
  TableParamsDTO,
  UpdateQueryDTO,
  UpsertQueryDTO,
} from './DTO/table.dto'
import { SchemasService } from './schemas.service'
import { RestContext, SelectQuery } from './schemas.types'
import { OrderParser, Parser, SelectParser } from '@nuvix/utils/query'

// Note: The `schemaId` parameter is used in hooks and must be included in all relevant routes.
@Controller({ version: ['1'], path: ['schemas/:schemaId', 'public'] })
@UseGuards(SchemaGuard)
@Namespace('schemas')
@UseInterceptors(ApiInterceptor)
@CurrentSchemaType([SchemaType.Managed, SchemaType.Unmanaged])
export class SchemasController {
  constructor(private readonly schemasService: SchemasService) {}

  @Get(['tables/:tableId'], {
    summary: 'Query table data',
    description: 'Retrieve data from a specific table with optional pagination',
    scopes: 'schemas.tables.read',
  })
  async queryTable(
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Req() request: NuvixRequest,
    @Query() query: SelectQueryDTO,
  ) {
    return this.schemasService.select({
      table,
      schema,
      query: this.parseQuery({ ...query, table }),
      context: this.buildContext(request),
    })
  }

  @Get(['tables/:tableId/count'], {
    summary: 'Count table rows',
    description:
      'Return the total number of rows in a table that match an optional filter',
    scopes: 'schemas.tables.read',
  })
  async countTable(
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Req() request: NuvixRequest,
    @Query() query: CountQueryDTO,
  ) {
    const parsed = query.filter
      ? { filter: Parser.create({ tableName: table }).parse(query.filter) }
      : {}
    return this.schemasService.count({
      table,
      schema,
      query: parsed,
      context: this.buildContext(request),
    })
  }

  @Get(['tables/:tableId/:rowId'], {
    summary: 'Get a single row',
    description: 'Retrieve a single row from a table by its primary key (_id)',
    scopes: 'schemas.tables.read',
  })
  async getRow(
    @Param()
    { schemaId: schema = 'public', tableId: table, rowId }: RowParamsDTO,
    @Req() request: NuvixRequest,
    @Query() query: SelectQueryDTO,
  ) {
    const rowFilter = `_id.eq.${Number(rowId)}`
    const combinedFilter = query.filter
      ? `and(${query.filter},${rowFilter})`
      : rowFilter
    return this.schemasService.select({
      table,
      schema,
      query: this.parseQuery({
        ...query,
        filter: combinedFilter,
        limit: 1,
        table,
      }),
      context: this.buildContext(request),
    })
  }

  @Post(['tables/:tableId'], {
    summary: 'Insert data into table',
    description:
      'Insert one or more records into a specific table. Use `on_conflict` to enable upsert behaviour.',
    scopes: 'schemas.tables.write',
  })
  async insertIntoTable(
    @Req() request: NuvixRequest,
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Body() input: Record<string, any> | Record<string, any>[],
    @Query() {
      columns,
      select,
      on_conflict,
      ignore_duplicates,
    }: InsertQueryDTO,
  ) {
    const onConflict = on_conflict
      ? on_conflict
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
      : undefined
    return this.schemasService.insert({
      schema,
      table,
      input,
      query: {
        ...this.parseQuery({ select, table }),
        columns,
        onConflict,
        ignoreDuplicates: ignore_duplicates,
      },
      context: this.buildContext(request),
    })
  }

  @Put(['tables/:tableId'], {
    summary: 'Upsert table data',
    description:
      'Insert or update records using ON CONFLICT DO UPDATE. Supply `on_conflict` with the column(s) to match on; omit to silently ignore duplicates.',
    scopes: 'schemas.tables.write',
  })
  async upsertTable(
    @Req() request: NuvixRequest,
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Body() input: Record<string, any> | Record<string, any>[],
    @Query() { columns, select, on_conflict }: UpsertQueryDTO,
  ) {
    const onConflict = on_conflict
      ? on_conflict
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
      : undefined
    return this.schemasService.upsert({
      schema,
      table,
      input,
      query: {
        ...this.parseQuery({ select, table }),
        columns,
        onConflict,
      },
      context: this.buildContext(request),
    })
  }

  @Patch(['tables/:tableId'], {
    summary: 'Update table data',
    description:
      'Update existing records in a specific table with optional pagination and force flag',
    scopes: 'schemas.tables.write',
  })
  async updateTables(
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Req() request: NuvixRequest,
    @Body() input: Record<string, any>,
    @Query() query: UpdateQueryDTO,
  ) {
    return this.schemasService.update({
      schema,
      table,
      input,
      query: this.parseQuery({ ...query, table }),
      context: this.buildContext(request),
    })
  }

  @Patch(['tables/:tableId/:rowId'], {
    summary: 'Update a single row',
    description:
      'Update a single row in a table identified by its primary key (_id)',
    scopes: 'schemas.tables.write',
  })
  async updateRow(
    @Param()
    { schemaId: schema = 'public', tableId: table, rowId }: RowParamsDTO,
    @Req() request: NuvixRequest,
    @Body() input: Record<string, any>,
    @Query() query: UpdateQueryDTO,
  ) {
    const rowFilter = `_id.eq.${Number(rowId)}`
    const combinedFilter = query.filter
      ? `and(${query.filter},${rowFilter})`
      : rowFilter
    return this.schemasService.update({
      schema,
      table,
      input,
      query: this.parseQuery({ ...query, filter: combinedFilter, table }),
      context: this.buildContext(request),
    })
  }

  @Delete(['tables/:tableId'], {
    summary: 'Delete table data',
    scopes: 'schemas.tables.write',
    description:
      'Delete records from a specific table with optional pagination and force flag',
    sdk: {
      name: 'delete',
      code: 200,
    },
  })
  async deleteTables(
    @Param() { schemaId: schema = 'public', tableId: table }: TableParamsDTO,
    @Req() request: NuvixRequest,
    @Query() query: DeleteQueryDTO,
  ) {
    return this.schemasService.delete({
      schema,
      table,
      query: this.parseQuery({ ...query, table }),
      context: this.buildContext(request),
    })
  }

  @Delete(['tables/:tableId/:rowId'], {
    summary: 'Delete a single row',
    description:
      'Delete a single row from a table identified by its primary key (_id)',
    scopes: 'schemas.tables.write',
  })
  async deleteRow(
    @Param()
    { schemaId: schema = 'public', tableId: table, rowId }: RowParamsDTO,
    @Req() request: NuvixRequest,
    @Query() query: DeleteQueryDTO,
  ) {
    const rowFilter = `_id.eq.${Number(rowId)}`
    const combinedFilter = query.filter
      ? `and(${query.filter},${rowFilter})`
      : rowFilter
    return this.schemasService.delete({
      schema,
      table,
      query: this.parseQuery({ ...query, filter: combinedFilter, table }),
      context: this.buildContext(request),
    })
  }

  @Post(['fn/:functionId', 'rpc/:functionId'], {
    summary: 'Call database function',
    description: 'Execute a stored procedure or function in the database',
    sdk: {
      name: 'rpc',
      code: 200,
    },
  })
  async callFunction(
    @Req() request: NuvixRequest,
    @Param() {
      schemaId: schema = 'public',
      functionId: functionName,
    }: FunctionParamsDTO,
    @Query() query: CallFunctionQueryDTO,
    @Body() args: Record<string, any> | any[] = [],
  ) {
    return this.schemasService.callFunction({
      schema,
      functionName,
      args,
      query: this.parseQuery({ ...query, table: functionName }),
      context: this.buildContext(request),
    })
  }

  @Put(['tables/:tableId/permissions'], {
    summary: 'Update table permissions',
    description: 'Manage permissions for a specific table',
    auth: [AuthType.ADMIN, AuthType.KEY],
  })
  @CurrentSchemaType(SchemaType.Managed)
  async manageTablePermissions(
    @Param() { schemaId: schema = 'public', tableId }: TableParamsDTO,
    @Body() body: PermissionsDTO,
  ): Promise<string[]> {
    return await this.schemasService.updatePermissions({
      permissions: body.permissions,
      tableId,
      schema,
    })
  }

  @Put(['tables/:tableId/:rowId/permissions'], {
    summary: 'Update row permissions',
    description: 'Manage permissions for a specific row in a table',
    auth: [AuthType.ADMIN, AuthType.KEY],
  })
  @CurrentSchemaType(SchemaType.Managed)
  async manageRowPermissions(
    @Param() { schemaId: schema = 'public', tableId, rowId }: RowParamsDTO,
    @Body() body: PermissionsDTO,
  ): Promise<string[]> {
    return await this.schemasService.updatePermissions({
      permissions: body.permissions,
      tableId,
      schema,
      rowId,
    })
  }

  @Get(['tables/:tableId/permissions'], {
    summary: 'Get table permissions',
    description: 'Retrieve permissions for a specific table',
    auth: [AuthType.ADMIN, AuthType.KEY],
  })
  @CurrentSchemaType(SchemaType.Managed)
  getTablePermissions(
    @Param() { schemaId: schema = 'public', tableId }: TableParamsDTO,
  ): Promise<string[]> {
    return this.schemasService.getPermissions({
      tableId,
      schema,
    })
  }

  @Get(['tables/:tableId/:rowId/permissions'], {
    summary: 'Get row permissions',
    description: 'Retrieve permissions for a specific row in a table',
    auth: [AuthType.ADMIN, AuthType.KEY],
  })
  @CurrentSchemaType(SchemaType.Managed)
  getRowPermissions(
    @Param() { schemaId: schema = 'public', tableId, rowId }: RowParamsDTO,
  ): Promise<string[]> {
    return this.schemasService.getPermissions({
      tableId,
      schema,
      rowId,
    })
  }

  private buildContext(request: NuvixRequest): RestContext {
    return {
      ip: request.ip,
      headers: request.headers,
      method: request.method,
      url: request.url,
      ctx: request.context,
      id: request.id,
    }
  }

  private parseQuery<T>(
    query: SelectQueryDTO & { table: string } & T,
  ): SelectQuery & T {
    const { filter, select, order, table: tableName, ...rest } = query
    let parsed: SelectQuery = { ...rest }

    if (filter) {
      parsed.filter = Parser.create({ tableName }).parse(filter)
    }
    if (select) {
      parsed.select = new SelectParser({ tableName }).parse(select)
    }
    if (order) {
      parsed.order = OrderParser.parse(order, tableName)
    }

    return parsed as SelectQuery & T
  }
}

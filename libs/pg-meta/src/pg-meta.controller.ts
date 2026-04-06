import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common'
import { CoreService } from '@nuvix/core/core.service'
import { Auth, AuthType } from '@nuvix/core/decorators'
import { Exception } from '@nuvix/core/extend/exception'
import { ParseComaStringPipe } from '@nuvix/core/pipes'
import { ConsoleInterceptor } from '@nuvix/core/resolvers'
import { ColumnCreateDTO } from './DTO/column-create.dto'
import { ColumnPrivilegeQueryDTO } from './DTO/column-privilege.dto'
import { ColumnPrivilegeGrantDTO } from './DTO/column-privilege-grant.dto'
import { ColumnPrivilegeRevokeDTO } from './DTO/column-privilege-revoke.dto'
import { ColumnUpdateDTO } from './DTO/column-update.dto'
import { ConfigQueryDTO } from './DTO/config.dto'
import { ExtensionQueryDTO } from './DTO/extension.dto'
import { ExtensionCreateDTO } from './DTO/extension-create.dto'
import { ExtensionDeleteQueryDTO } from './DTO/extension-delete.dto'
import { ExtensionNameParamDTO } from './DTO/extension-name.dto'
import { ExtensionUpdateDTO } from './DTO/extension-update.dto'
import { ForeignTableQueryDTO } from './DTO/foreign-table.dto'
import { ForeignTableIdParamDTO } from './DTO/foreign-table-id.dto'
import { FunctionQueryDTO } from './DTO/function.dto'
import { FunctionCreateDTO } from './DTO/function-create.dto'
import { FunctionIdParamDTO } from './DTO/function-id.dto'
import { FunctionUpdateDTO } from './DTO/function-update.dto'
import { GeneratorQueryDTO } from './DTO/generator.dto'
import { IndexQueryDTO } from './DTO/index.dto'
import { IndexIdParamDTO } from './DTO/index-id.dto'
import { MaterializedViewQueryDTO } from './DTO/materialized-view.dto'
import { MaterializedViewIdParamDTO } from './DTO/materialized-view-id.dto'
import { PolicyQueryDTO } from './DTO/policy.dto'
import { PolicyCreateDTO } from './DTO/policy-create.dto'
import { PolicyUpdateDTO } from './DTO/policy-update.dto'
import { PublicationQueryDTO } from './DTO/publication.dto'
import { PublicationCreateDTO } from './DTO/publication-create.dto'
import { PublicationUpdateDTO } from './DTO/publication-update.dto'
import { DeparseDTO, QueryDTO } from './DTO/query.dto'
import { RoleQueryDTO } from './DTO/role.dto'
import { RoleCreateDTO } from './DTO/role-create.dto'
import { RoleIdParamDTO } from './DTO/role-id.dto'
import { RoleUpdateDTO } from './DTO/role-update.dto'
import { SchemaQueryDTO } from './DTO/schema.dto'
import { SchemaCreateDTO } from './DTO/schema-create.dto'
import { SchemaDeleteQueryDTO } from './DTO/schema-delete.dto'
import { SchemaIdParamDTO } from './DTO/schema-id.dto'
import { SchemaUpdateDTO } from './DTO/schema-update.dto'
import { TableCreateDTO } from './DTO/table-create.dto'
import { TableIdParamDTO } from './DTO/table-id.dto'
import { TablePrivilegeQueryDTO } from './DTO/table-privilege.dto'
import { TablePrivilegeGrantDTO } from './DTO/table-privilege-grant.dto'
import { TablePrivilegeRevokeDTO } from './DTO/table-privilege-revoke.dto'
import { TableUpdateDTO } from './DTO/table-update.dto'
import { TriggerQueryDTO } from './DTO/trigger.dto'
import { TriggerCreateDTO } from './DTO/trigger-create.dto'
import { TriggerDeleteQueryDTO } from './DTO/trigger-delete.dto'
import { TriggerUpdateDTO } from './DTO/trigger-update.dto'
import { TypeQueryDTO } from './DTO/type.dto'
import { ViewQueryDTO } from './DTO/view.dto'
import { ViewIdParamDTO } from './DTO/view-id.dto'
import { PgMetaExceptionFilter } from './extra/exception.filter'
import { PostgresMeta } from './lib'
import { getGeneratorMetadata } from './lib/generators'
import * as Parser from './lib/Parser'
import { PgMetaService } from './pg-meta.service'
import { apply as applyGoTemplate } from './templates/go'
import { apply as applySwiftTemplate } from './templates/swift'

@Controller({ path: 'database', version: ['1', VERSION_NEUTRAL] })
@UseInterceptors(ConsoleInterceptor)
@Auth(AuthType.ADMIN)
@UseFilters(PgMetaExceptionFilter)
export class PgMetaController {
  protected client: PostgresMeta

  constructor(
    private readonly pgMetaService: PgMetaService,
    private readonly coreService: CoreService,
  ) {
    this.client = new PostgresMeta(this.coreService.getPoolForPostgres())
  }

  @Post('query')
  async query(@Body() body: QueryDTO) {
    const { data } = await this.client.query(body.query, false)
    return data ?? []
  }

  @Post('query/format')
  async format(@Body() body: QueryDTO) {
    const { data } = await Parser.Format(body.query)
    return data
  }

  @Post('query/parse')
  async parse(@Body() body: QueryDTO) {
    const { data } = Parser.Parse(body.query)
    return data
  }

  @Post('query/deparse')
  async deparse(@Body() body: DeparseDTO) {
    const { data } = await Parser.Deparse(body.ast)
    return data
  }

  /*************************** Schemas *********************************/

  @Get('schemas')
  async getSchemas(@Query() query: SchemaQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.schemas.list({
      includeSystemSchemas,
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('schemas/:id')
  async getSchemaById(@Param('id') id: number) {
    const { data } = await this.client.schemas.retrieve({ id })
    return data
  }

  @Post('schemas')
  async createSchema(@Body() body: SchemaCreateDTO) {
    const { data } = await this.client.schemas.create(body)
    return data
  }

  @Patch('schemas/:id')
  async updateSchema(
    @Param() params: SchemaIdParamDTO,
    @Body() body: SchemaUpdateDTO,
  ) {
    const { id } = params
    const { data } = await this.client.schemas.update(id, body)
    return data
  }

  @Delete('schemas/:id')
  async deleteSchema(
    @Param() params: SchemaIdParamDTO,
    @Query() query: SchemaDeleteQueryDTO,
  ) {
    const { id } = params
    const { cascade } = query
    const { data } = await this.client.schemas.remove(id, { cascade })
    return data
  }

  /*************************** Tables *********************************/

  @Get('tables')
  async getTables(
    @Query('include_system_schemas') includeSystemSchemas = false,
    @Query('limit') limit = 0,
    @Query('offset') offset = 0,
    @Query('include_columns') includeColumns = false,
    @Query('included_schemas') includedSchemas?: string,
    @Query('excluded_schemas') excludedSchemas?: string,
  ) {
    const { data } = await this.client.tables.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
      includeColumns: includeColumns,
    })
    return data ?? []
  }

  @Get('tables/:id')
  async getTableById(@Param() params: TableIdParamDTO) {
    const { id } = params
    const { data } = await this.client.tables.retrieve({ id })
    return data
  }

  @Post('tables')
  async createTable(@Body() body: TableCreateDTO) {
    const { data } = await this.client.tables.create(body)
    return data
  }

  @Patch('tables/:id')
  async updateTable(
    @Param() params: TableIdParamDTO,
    @Body() body: TableUpdateDTO,
  ) {
    const { id } = params
    const { data } = await this.client.tables.update(id, body)
    return data
  }

  @Delete('tables/:id')
  async deleteTable(
    @Param() params: TableIdParamDTO,

    @Query('cascade') cascade?: boolean,
  ) {
    const { id } = params
    const { data } = await this.client.tables.remove(id, { cascade })
    return data
  }

  /*************************** Columns *********************************/

  @Get('columns')
  async getColumns(
    @Query('include_system_schemas') includeSystemSchemas?: boolean,
    @Query('included_schemas', ParseComaStringPipe) includedSchemas?: string[],
    @Query('excluded_schemas', ParseComaStringPipe) excludedSchemas?: string[],
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const { data } = await this.client.columns.list({
      includeSystemSchemas,
      includedSchemas,
      excludedSchemas,
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('columns/:tableAndOrdinalPosition')
  async getColumnsByTable(
    @Param('tableAndOrdinalPosition') id: string,

    @Query('include_system_schemas') includeSystemSchemas?: boolean,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('included_schemas', ParseComaStringPipe) includedSchemas?: string[],
    @Query('excluded_schemas', ParseComaStringPipe) excludedSchemas?: string[],
  ) {
    let tableId: number
    let ordinalPosition!: string
    if (id.includes('.')) {
      const [tableIdString, ordinalPositionString] = id.split('.') as [
        string,
        string,
      ]
      tableId = Number.parseInt(tableIdString, 10)
      ordinalPosition = ordinalPositionString
    } else {
      tableId = Number.parseInt(id, 10)
    }

    if (ordinalPosition) {
      // Get all columns for the table
      const { data } = await this.client.columns.list({
        tableId,
        includeSystemSchemas,
        limit,
        offset,
        includedSchemas,
        excludedSchemas,
      })
      if (data?.[0]) {
        return data[0]
      }
      throw new Exception(Exception.GENERAL_NOT_FOUND)
    }
    if (/^\.\d+$/.test(ordinalPosition)) {
      // Get specific column by tableId.ordinalPosition
      const position = ordinalPosition.slice(1)
      const id = `${tableId}.${position}`
      const { data } = await this.client.columns.retrieve({ id })
      return data
    }
    throw new Exception(Exception.GENERAL_NOT_FOUND)
  }

  @Post('columns')
  async createColumn(@Body() body: ColumnCreateDTO) {
    const { data } = await this.client.columns.create(body)
    return data
  }

  @Patch('columns/:id')
  async updateColumn(@Param('id') id: string, @Body() body: ColumnUpdateDTO) {
    const { data } = await this.client.columns.update(id, body)
    return data
  }

  @Delete('columns/:id')
  async deleteColumn(
    @Param('id') id: string,

    @Query('cascade') cascade?: boolean,
  ) {
    const { data } = await this.client.columns.remove(id, { cascade })
    return data
  }

  /*************************** Extensions *********************************/

  @Get('extensions')
  async getExtensions(@Query() query: ExtensionQueryDTO) {
    const { limit, offset } = query
    const { data } = await this.client.extensions.list({ limit, offset })
    return data ?? []
  }

  @Get('extensions/:name')
  async getExtensionByName(@Param() params: ExtensionNameParamDTO) {
    const { name } = params
    const { data } = await this.client.extensions.retrieve({ name })
    return data
  }

  @Post('extensions')
  async createExtension(@Body() body: ExtensionCreateDTO) {
    const { data } = await this.client.extensions.create(body)
    return data
  }

  @Patch('extensions/:name')
  async updateExtension(
    @Param() params: ExtensionNameParamDTO,
    @Body() body: ExtensionUpdateDTO,
  ) {
    const { name } = params
    const { data } = await this.client.extensions.update(name, body)
    return data
  }

  @Delete('extensions/:name')
  async deleteExtension(
    @Param() params: ExtensionNameParamDTO,
    @Query() query: ExtensionDeleteQueryDTO,
  ) {
    const { name } = params
    const { cascade } = query
    const { data } = await this.client.extensions.remove(name, { cascade })
    return data
  }

  /*************************** Roles *********************************/

  @Get('roles')
  async getRoles(@Query() query: RoleQueryDTO) {
    const { include_default_roles: includeDefaultRoles, limit, offset } = query
    const { data } = await this.client.roles.list({
      includeDefaultRoles,
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('roles/:id')
  async getRoleById(@Param() params: RoleIdParamDTO) {
    const { id } = params
    const { data } = await this.client.roles.retrieve({ id })
    return data
  }

  @Post('roles')
  async createRole(@Body() body: RoleCreateDTO) {
    const { data } = await this.client.roles.create(body)
    return data
  }

  @Patch('roles/:id')
  async updateRole(
    @Param() params: RoleIdParamDTO,
    @Body() body: RoleUpdateDTO,
  ) {
    const { id } = params
    const { data } = await this.client.roles.update(id, body)
    return data
  }

  @Delete('roles/:id')
  async deleteRole(@Param() params: RoleIdParamDTO) {
    const { id } = params
    const { data } = await this.client.roles.remove(id)
    return data
  }

  /*************************** Functions *********************************/

  @Get('functions')
  async getFunctions(@Query() query: FunctionQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.functions.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('functions/:id')
  async getFunctionById(@Param() params: FunctionIdParamDTO) {
    const { id } = params
    const { data } = await this.client.functions.retrieve({ id })
    return data
  }

  @Post('functions')
  async createFunction(@Body() body: FunctionCreateDTO) {
    const { data } = await this.client.functions.create(body)
    return data
  }

  @Patch('functions/:id')
  async updateFunction(
    @Param() params: FunctionIdParamDTO,
    @Body() body: FunctionUpdateDTO,
  ) {
    const { id } = params
    const { data } = await this.client.functions.update(id, body)
    return data
  }

  @Delete('functions/:id')
  async deleteFunction(@Param() params: FunctionIdParamDTO) {
    const { id } = params
    const { data } = await this.client.functions.remove(id)
    return data
  }

  /*************************** Indexes *********************************/

  @Get('indexes')
  async getIndexes(@Query() query: IndexQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.indexes.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('indexes/:id')
  async getIndexById(@Param() params: IndexIdParamDTO) {
    const { id } = params
    const { data } = await this.client.indexes.retrieve({ id })
    return data
  }

  /*************************** Views *********************************/

  @Get('views')
  async getViews(@Query() query: ViewQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
      include_columns: includeColumns,
    } = query
    const { data } = await this.client.views.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
      includeColumns,
    })
    return data ?? []
  }

  @Get('views/:id')
  async getViewById(@Param() params: ViewIdParamDTO) {
    const { id } = params
    const { data } = await this.client.views.retrieve({ id })
    return data
  }

  /*************************** Foreign Tables *********************************/

  @Get('foreign-tables')
  async getForeignTables(@Query() query: ForeignTableQueryDTO) {
    const { limit, offset, include_columns: includeColumns } = query
    const { data } = await this.client.foreignTables.list({
      limit,
      offset,
      includeColumns,
    })
    return data ?? []
  }

  @Get('foreign-tables/:id')
  async getForeignTableById(@Param() params: ForeignTableIdParamDTO) {
    const { id } = params
    const { data } = await this.client.foreignTables.retrieve({ id })
    return data
  }

  /*************************** Column Privileges *********************************/

  @Get('column-privileges')
  async getColumnPrivileges(@Query() query: ColumnPrivilegeQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.columnPrivileges.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Post('column-privileges')
  async grantColumnPrivileges(@Body() body: ColumnPrivilegeGrantDTO[]) {
    const { data } = await this.client.columnPrivileges.grant(body)
    return data
  }

  @Delete('column-privileges')
  async revokeColumnPrivileges(@Body() body: ColumnPrivilegeRevokeDTO[]) {
    const { data } = await this.client.columnPrivileges.revoke(body)
    return data
  }

  /*************************** Materialized Views *********************************/

  @Get('materialized-views')
  async getMaterializedViews(@Query() query: MaterializedViewQueryDTO) {
    const {
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
      include_columns: includeColumns,
    } = query
    const { data } = await this.client.materializedViews.list({
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
      includeColumns,
    })
    return data ?? []
  }

  @Get('materialized-views/:id')
  async getMaterializedViewById(@Param() params: MaterializedViewIdParamDTO) {
    const { id } = params
    const { data } = await this.client.materializedViews.retrieve({ id })
    return data
  }

  /*************************** Config *********************************/

  @Get('config')
  async getConfig(@Query() query: ConfigQueryDTO) {
    const { limit, offset } = query
    const { data } = await this.client.config.list({ limit, offset })
    return data ?? []
  }

  @Get('config/version')
  async getVersion() {
    const { data } = await this.client.version.retrieve()
    return data
  }

  /*************************** Policies *********************************/

  @Get('policies')
  async getPolicies(@Query() query: PolicyQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.policies.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('policies/:id')
  async getPolicyById(@Param('id') id: number) {
    const { data } = await this.client.policies.retrieve({ id })
    return data
  }

  @Post('policies')
  async createPolicy(@Body() body: PolicyCreateDTO) {
    const { data } = await this.client.policies.create(body)
    return data
  }

  @Patch('policies/:id')
  async updatePolicy(@Param('id') id: number, @Body() body: PolicyUpdateDTO) {
    const { data } = await this.client.policies.update(id, body)
    return data
  }

  @Delete('policies/:id')
  async deletePolicy(@Param('id') id: number) {
    const { data } = await this.client.policies.remove(id)
    return data
  }

  /*************************** Publications *********************************/

  @Get('publications')
  async getPublications(@Query() query: PublicationQueryDTO) {
    const { limit, offset } = query
    const { data } = await this.client.publications.list({ limit, offset })
    return data ?? []
  }

  @Get('publications/:id')
  async getPublicationById(@Param('id') id: number) {
    const { data } = await this.client.publications.retrieve({ id })
    return data
  }

  @Post('publications')
  async createPublication(@Body() body: PublicationCreateDTO) {
    const { data } = await this.client.publications.create(body)
    return data
  }

  @Patch('publications/:id')
  async updatePublication(
    @Param('id') id: number,
    @Body() body: PublicationUpdateDTO,
  ) {
    const { data } = await this.client.publications.update(id, body)
    return data
  }

  @Delete('publications/:id')
  async deletePublication(@Param('id') id: number) {
    const { data } = await this.client.publications.remove(id)
    return data
  }

  /*************************** Table Privileges *********************************/

  @Get('table-privileges')
  async getTablePrivileges(@Query() query: TablePrivilegeQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.tablePrivileges.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Post('table-privileges')
  async grantTablePrivileges(@Body() body: TablePrivilegeGrantDTO[]) {
    const { data } = await this.client.tablePrivileges.grant(body)
    return data
  }

  @Delete('table-privileges')
  async revokeTablePrivileges(@Body() body: TablePrivilegeRevokeDTO[]) {
    const { data } = await this.client.tablePrivileges.revoke(body)
    return data
  }

  /*************************** Triggers *********************************/

  @Get('triggers')
  async getTriggers(@Query() query: TriggerQueryDTO) {
    const {
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.triggers.list({
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  @Get('triggers/:id')
  async getTriggerById(@Param('id') id: number) {
    const { data } = await this.client.triggers.retrieve({ id })
    return data
  }

  @Post('triggers')
  async createTrigger(@Body() body: TriggerCreateDTO) {
    const { data } = await this.client.triggers.create(body)
    return data
  }

  @Patch('triggers/:id')
  async updateTrigger(@Param('id') id: number, @Body() body: TriggerUpdateDTO) {
    const { data } = await this.client.triggers.update(id, body)
    return data
  }

  @Delete('triggers/:id')
  async deleteTrigger(
    @Param('id') id: number,
    @Query() query: TriggerDeleteQueryDTO,
  ) {
    const { cascade } = query
    const { data } = await this.client.triggers.remove(id, { cascade })
    return data
  }

  /*************************** Types *********************************/

  @Get('types')
  async getTypes(@Query() query: TypeQueryDTO) {
    const {
      include_array_types: includeArrayTypes,
      include_system_schemas: includeSystemSchemas,
      included_schemas: includedSchemas,
      excluded_schemas: excludedSchemas,
      limit,
      offset,
    } = query
    const { data } = await this.client.types.list({
      includeArrayTypes,
      includeSystemSchemas,
      includedSchemas: includedSchemas?.split(','),
      excludedSchemas: excludedSchemas?.split(','),
      limit,
      offset,
    })
    return data ?? []
  }

  /*************************** Generators *********************************/

  @Get('generators/typescript')
  async generateTypescript(@Query() query: GeneratorQueryDTO) {
    return this.pgMetaService.generateTypescript(this.client, query)
  }

  @Get('generators/go')
  async generateGo(@Query() query: GeneratorQueryDTO) {
    const { included_schemas, excluded_schemas } = query
    const { data } = await getGeneratorMetadata(this.client, {
      includedSchemas: included_schemas
        ?.split(',')
        .map(schema => schema.trim()),
      excludedSchemas: excluded_schemas
        ?.split(',')
        .map(schema => schema.trim()),
    })
    return applyGoTemplate(data!)
  }

  @Get('generators/swift')
  async generateSwift(@Query() query: GeneratorQueryDTO) {
    const { included_schemas, excluded_schemas, access_control } = query
    const { data } = await getGeneratorMetadata(this.client, {
      includedSchemas: included_schemas
        ?.split(',')
        .map(schema => schema.trim()),
      excludedSchemas: excluded_schemas
        ?.split(',')
        .map(schema => schema.trim()),
    })
    return applySwiftTemplate({
      ...data!,
      accessControl: access_control ?? 'internal',
    })
  }
}

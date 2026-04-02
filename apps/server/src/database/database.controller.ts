import { Body, Controller, Param, Query, UseInterceptors } from '@nestjs/common'
import { Delete, Get, Patch, Post } from '@nuvix/core'
import { Auth, AuthType, Namespace } from '@nuvix/core/decorators'
import { Models } from '@nuvix/core/helpers'
import { ApiInterceptor, ResponseInterceptor } from '@nuvix/core/resolvers'
import { IListResponse, SchemaType } from '@nuvix/utils'
// DTO's
import {
  CreateSchemaDTO,
  SchemaParamsDTO,
  SchemaQueryDTO,
  UpdateSchemaDTO,
} from './DTO/create-schema.dto'
import { DatabaseService } from './database.service'

@Controller({ version: ['1'], path: ['database'] })
@Namespace('database')
@UseInterceptors(ResponseInterceptor, ApiInterceptor)
@Auth([AuthType.ADMIN, AuthType.KEY])
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get('schemas', {
    summary: 'List schemas',
    description:
      'Retrieve a list of all schemas in the database with optional filtering by type',
    scopes: 'schemas.read',
    model: { type: Models.SCHEMA, list: true },
    sdk: {
      name: 'listSchemas',
    },
  })
  async getSchemas(
    @Query() { type }: SchemaQueryDTO,
  ): Promise<IListResponse<unknown>> {
    const schemas = await this.databaseService.getSchemas(type)
    return schemas
  }

  @Post('schemas', {
    summary: 'Create schema',
    description:
      'Create a new schema in the database. Supports managed, unmanaged, and document schema types',
    scopes: 'schemas.write',
    model: Models.SCHEMA,
    sdk: {
      name: 'createSchema',
    },
  })
  async createSchema(@Body() body: CreateSchemaDTO) {
    const result = await (body.type !== SchemaType.Document
      ? this.databaseService.createSchema(body)
      : this.databaseService.createDocumentSchema(body))
    return result
  }

  @Get('schemas/:schemaId', {
    summary: 'Get schema',
    description: 'Retrieve a specific schema by its ID',
    scopes: 'schemas.read',
    model: Models.SCHEMA,
    sdk: {
      name: 'getSchema',
    },
  })
  async getSchema(@Param() { schemaId }: SchemaParamsDTO) {
    const result = await this.databaseService.getSchema(schemaId)
    return result
  }

  @Patch('schemas/:schemaId', {
    summary: 'Update schema',
    description: 'Update a schema description',
    scopes: 'schemas.write',
    model: Models.SCHEMA,
    sdk: {
      name: 'updateSchema',
    },
  })
  async updateSchema(
    @Param() { schemaId }: SchemaParamsDTO,
    @Body() body: UpdateSchemaDTO,
  ) {
    return this.databaseService.updateSchema(schemaId, body.description)
  }

  @Delete('schemas/:schemaId', {
    summary: 'Delete schema',
    description:
      'Permanently delete a schema and all its tables from the database',
    scopes: 'schemas.write',
    sdk: {
      name: 'deleteSchema',
      code: 204,
    },
  })
  async deleteSchema(@Param() { schemaId }: SchemaParamsDTO) {
    await this.databaseService.deleteSchema(schemaId)
  }
}

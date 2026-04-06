import { Injectable } from '@nestjs/common'
import { DataSource } from '@nuvix/pg'
import { type Schema, Schemas, SchemaType } from '@nuvix/utils'
import { CoreService } from '../../core.service.js'
import { Exception } from '../../extend/exception'
import { Hook } from '../../server'

@Injectable()
export class SchemaHook implements Hook {
  private readonly dataSource: DataSource
  constructor(private readonly coreService: CoreService) {
    if (this.coreService.isConsole()) {
      throw new Exception(
        'SchemaHook should not be initialized in console application',
      )
    }
    this.dataSource = this.coreService.getDataSourceWithMainPool()
  }

  async preHandler(request: NuvixRequest) {
    const schemaId = (request.params as { schemaId: string | undefined })
      .schemaId

    if (schemaId === undefined) {
      throw new Exception(Exception.SCHEMA_NOT_FOUND)
    }

    const { project } = request.context

    const schema = await this.dataSource
      .table<Schema>('schemas')
      .withSchema(Schemas.System)
      .where('name', schemaId)
      .first()

    if (schema) {
      request.context.currentSchema = schema
      if (!request.context.isAPIUser && !schema.enabled) {
        throw new Exception(Exception.SCHEMA_NOT_FOUND)
      }

      if (schema.type === SchemaType.Document) {
        request.context.currentSchemaDB = this.coreService.getDatabaseForSchema(
          schema.name,
        )
        return
      }

      if (!request.context.isAPIUser) {
        const allowed = project.get('metadata')?.allowedSchemas ?? []
        // May be we will add Document schema too in future
        if (
          !allowed.includes(schema.name)
          // && schema.type !== SchemaType.Document
        ) {
          throw new Exception(
            Exception.GENERAL_ACCESS_FORBIDDEN,
            `Access denied: Schema '${schema.name}' is not exposed to the client API.`,
          )
        }
      }
    } else {
      throw new Exception(Exception.SCHEMA_NOT_FOUND)
    }
  }
}

import { ApiProperty } from '@nestjs/swagger'
import { SchemaType } from '@nuvix/utils'
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'

export class CreateSchemaDTO {
  @ApiProperty({
    description: 'Schema name',
    example: 'my_schema',
    type: String,
    required: true,
    minLength: 1,
    maxLength: 255,
    pattern: '^[a-z][a-z0-9_]{0,254}$',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,254}$/, {
    message:
      'name must start with a lowercase letter, may contain lowercase letters, numbers and underscores, and must not start with an underscore',
  })
  name!: string

  @ApiProperty({
    description: 'Schema description',
    example: 'This is my schema',
    type: String,
    required: false,
    minLength: 0,
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  description?: string

  @ApiProperty({
    description: 'Schema type, either managed, unmanaged or document',
    enum: SchemaType,
    example: 'managed',
  })
  @IsEnum(SchemaType)
  declare type: SchemaType
}

export class UpdateSchemaDTO {
  @ApiProperty({
    description: 'New schema description',
    example: 'Updated description',
    type: String,
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string
}

// Query

export class SchemaQueryDTO {
  @ApiProperty({
    description: 'Schema type, either managed, unmanaged or document',
    enum: SchemaType,
    example: 'managed',
  })
  @IsOptional()
  @IsEnum(SchemaType)
  type?: SchemaType
}

// Params

export class SchemaParamsDTO {
  /**
   * Schema ID.
   */
  @IsString()
  declare schemaId: string
}

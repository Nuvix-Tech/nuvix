import { IsPositiveInt } from '@nuvix/core/validators'

export class SchemaIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

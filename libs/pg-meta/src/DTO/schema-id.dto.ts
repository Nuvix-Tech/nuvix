import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class SchemaIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

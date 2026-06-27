import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class TableIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

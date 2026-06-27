import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class IndexIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

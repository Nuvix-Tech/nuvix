import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class ViewIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

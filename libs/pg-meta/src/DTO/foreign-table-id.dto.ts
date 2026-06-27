import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class ForeignTableIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

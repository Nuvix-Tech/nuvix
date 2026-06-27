import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class FunctionIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

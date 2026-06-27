import { IsPositiveInt, TryTransformTo } from '@nuvix/core/validators'

export class RoleIdParamDTO {
  @IsPositiveInt()
  @TryTransformTo('int')
  declare id: number
}

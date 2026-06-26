import { IsPositiveInt } from '@nuvix/core/validators'

export class RoleIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

import { IsPositiveInt } from '@nuvix/core/validators'

export class ViewIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

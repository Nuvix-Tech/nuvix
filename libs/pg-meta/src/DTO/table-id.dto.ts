import { IsPositiveInt } from '@nuvix/core/validators'

export class TableIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

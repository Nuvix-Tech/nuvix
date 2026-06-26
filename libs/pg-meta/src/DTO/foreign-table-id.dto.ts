import { IsPositiveInt } from '@nuvix/core/validators'

export class ForeignTableIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

import { IsPositiveInt } from '@nuvix/core/validators'

export class IndexIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

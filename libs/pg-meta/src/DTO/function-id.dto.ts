import { IsPositiveInt } from '@nuvix/core/validators'

export class FunctionIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

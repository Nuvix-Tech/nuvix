import { IsPositiveInt } from '@nuvix/core/validators'

export class MaterializedViewIdParamDTO {
  @IsPositiveInt()
  declare id: number
}

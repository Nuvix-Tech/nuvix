import {
  ArrayToLastElement,
  TransformStringToBoolean,
  TryTransformTo,
} from '@nuvix/core/validators'
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator'

export class CreditCardParamDTO {
  /**
   * Credit card code (e.g., 'visa', 'mastercard', etc.)
   */
  @IsString()
  @IsNotEmpty()
  declare code: string
}

export class BrowsersParamDTO {
  /**
   * Browser code (e.g., 'ch', 'ff', etc.)
   */
  @IsString()
  @IsNotEmpty()
  declare code: string
}

export class FlagsParamDTO {
  /**
   * Country code (e.g., 'us', 'in', etc.)
   */
  @IsString()
  @IsNotEmpty()
  declare code: string
}

export class InitialsQueryDTO {
  /**
   * User's name to generate initials from (e.g., 'John Doe')
   */
  @IsOptional()
  @ArrayToLastElement()
  @IsString()
  name?: string

  /**
   * Width of the generated avatar image (default: 500)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('number')
  @IsNumber()
  @Min(1)
  @Max(2000)
  width = 500

  /**
   * Height of the generated avatar image (default: 500)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('number')
  @IsNumber()
  @Min(1)
  @Max(2000)
  height = 500

  /**
   * Background color for the avatar (e.g., '#ff0000')
   */
  @IsOptional()
  @ArrayToLastElement()
  @IsString()
  @Length(0, 7)
  background?: string

  /**
   * Whether to generate a circular avatar (default: false)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TransformStringToBoolean()
  circle = false
}

export class CodesQuerDTO {
  /**
   * Width of the image (default: 100)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('int')
  @IsNumber()
  @Min(1)
  @Max(2000)
  width = 100

  /**
   * Height of the image (default: 100)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('int')
  @IsNumber()
  @Min(1)
  @Max(2000)
  height = 100

  /**
   * Quality of the image (default: 90, range: 0-100)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('int')
  @IsNumber()
  @Min(0)
  @Max(100)
  quality = 90
}

export class FaviconQueryDTO {
  /**
   * URL of the image to process
   */
  @ArrayToLastElement()
  @IsUrl()
  @IsString()
  @IsNotEmpty()
  declare url: string
}

export class QrQueryDTO {
  /**
   * Data to encode in the QR code
   */
  @ArrayToLastElement()
  @IsString()
  @IsNotEmpty()
  @Length(1, 512)
  declare text: string

  /**
   * Size of the QR code (default: 400)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('int')
  @IsNumber()
  @Min(1)
  @Max(1000)
  size = 400

  /**
   * Margin from edge (default: 1)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TryTransformTo('int')
  @IsNumber()
  @Min(0)
  @Max(10)
  margin = 1

  /**
   * Whether to download the image (default: false)
   */
  @IsOptional()
  @ArrayToLastElement()
  @TransformStringToBoolean()
  download = false
}

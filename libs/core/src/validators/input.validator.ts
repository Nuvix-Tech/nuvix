import { RolesValidator } from '@nuvix/db'
import { Transform } from 'class-transformer'
import {
  isBoolean,
  registerDecorator,
  ValidateIf,
  ValidationOptions,
} from 'class-validator'
import { Exception } from '../extend/exception'

/**
 * Decorator that checks if a property is a valid unique ID.
 * The ID can be a string that is alphanumeric and can include period, hyphen, and underscore,
 * but cannot start with a special character.
 */
export function IsUID(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isUniqueID',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const regex = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
          return typeof value === 'string' && regex.test(value)
        },
        defaultMessage() {
          return `${String(propertyName)} must be alphanumeric and can include period, hyphen, and underscore. Cannot start with a special character. Max length is 36 chars.`
        },
      },
    })
  }
}

/**
 * Decorator that checks if a property is a valid custom ID.
 * The ID can be a string that is alphanumeric and can include period, hyphen, and underscore,
 * but cannot start with a special character. It can also be the string "unique()".
 * This is typically used for identifiers in a database or configuration.
 */
export function IsCustomID(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCustomID',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const regex = /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}|unique\(\))$/
          return typeof value === 'string' && regex.test(value)
        },
        defaultMessage() {
          return `${String(propertyName)} must be either "unique()" or alphanumeric and can include period, hyphen, and underscore. Cannot start with a special character. Max length is 36 chars.`
        },
      },
    })
  }
}

/**
 * Decorator that checks if a property is a valid key.
 * The key must be alphanumeric and can include underscore, but cannot start with a special character.
 * It is typically used for identifiers or keys in a database or configuration.
 */
export function IsKey(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isKey',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const regex = /^[a-zA-Z0-9_]+$/
          return typeof value === 'string' && regex.test(value)
        },
        defaultMessage() {
          return `${String(propertyName)} must be alphanumeric and can include underscore. Cannot start with a special character.`
        },
      },
    })
  }
}

/**
 * Decorator that transforms string values 'true' to boolean true
 * and any other string to boolean false. If the value is already
 * a boolean, it keeps it as is.
 */
export function TransformStringToBoolean() {
  return (target: any, propertyKey: string) => {
    Transform(({ value }) => {
      if (isBoolean(value)) {
        return value
      }
      return value === 'true'
    })(target, propertyKey)

    ValidateIf((_, value) => value !== undefined)(target, propertyKey)
  }
}

/**
 * Decorator that checks if a property is a valid date in the future.
 */
export function IsFutureDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const date = typeof value === 'string' ? new Date(value) : value
          const now = new Date()
          return !Number.isNaN(date.getTime()) && date > now
        },
        defaultMessage() {
          return `${String(propertyName)} must be a valid date in the future.`
        },
      },
    })
  }
}

export function IsCompoundID(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCompoundID',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const regex =
            /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}:[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
          return typeof value === 'string' && regex.test(value)
        },
        defaultMessage() {
          return `${String(propertyName)} must be in the format <ID>:<ID> where each ID is alphanumeric and can include period, hyphen, and underscore. Cannot start with a special character. Max length for each ID is 36 chars.`
        },
      },
    })
  }
}

export function IsPermissionsArray(
  validationOptions?: ValidationOptions & { limit?: number },
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPermissionsArray',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: any) {
          const validator = new RolesValidator(validationOptions?.limit)
          return validator.$valid(value)
        },
        defaultMessage() {
          return `${String(propertyName)} must be a valid permissions array.`
        },
      },
    })
  }
}

/**
 * Decorator that transforms an array to its last element.
 * If the value is not an array, it keeps it as is.
 */
export function ArrayToLastElement() {
  return (target: any, propertyKey: string) => {
    Transform(({ value }) => {
      if (Array.isArray(value)) {
        return value[value.length - 1]
      }
      return value
    })(target, propertyKey)
  }
}

/**
 * Decorator that attempts to transform a value to the specified type.
 * If the transformation fails, it keeps the original value.
 * @param type - The target type to transform to. Currently supports "number".
 */
export function TryTransformTo(type: 'number' | 'int') {
  return (target: any, propertyKey: string) => {
    Transform(({ value }) => {
      if (type === 'number') {
        const parsed = Number(value)
        return Number.isNaN(parsed) ? value : parsed
      }
      if (type === 'int') {
        const parsed = Number.parseInt(value, 10)
        return Number.isNaN(parsed) ? value : parsed
      }
      return value
    })(target, propertyKey)
  }
}

export function TrySplitStringToArray(separator: string) {
  return (target: any, propertyKey: string) => {
    Transform(({ value }) => {
      if (typeof value !== 'string' && typeof value !== 'undefined')
        throw new Exception(
          Exception.GENERAL_BAD_REQUEST,
          `${String(propertyKey)} must be a string to be split into an array.`,
        )
      return value
        ? value
            .split(separator)
            .map(item => item.trim())
            .filter(Boolean)
        : undefined
    })(target, propertyKey)
  }
}

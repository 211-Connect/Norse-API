import {
  ValidationOptions,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

export function IsStringNumberRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStringNumberRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
          ) {
            return false;
          }

          return Object.entries(value as Record<string, unknown>).every(
            ([key, weight]) =>
              typeof key === 'string' &&
              key.trim().length > 0 &&
              typeof weight === 'number' &&
              Number.isFinite(weight),
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an object with string keys and numeric values`;
        },
      },
    });
  };
}

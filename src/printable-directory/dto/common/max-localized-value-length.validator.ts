import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/** Max length of a cover title or section heading, in every locale. */
export const PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH = 200;

/** Max length of a description or header/footer text, in every locale. */
export const PRINTABLE_DIRECTORY_LONG_TEXT_MAX_LENGTH = 2000;

/**
 * Caps every value of a localized field's `values` map. Without it, a
 * localized field accepts arbitrarily long text, which Norse then
 * machine-translates (and pays for) into every directory language.
 */
export function MaxLocalizedValueLength(
  maxLength: number,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxLocalizedValueLength',
      target: object.constructor,
      propertyName,
      constraints: [maxLength],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          const values = (value as { values?: unknown } | null | undefined)
            ?.values;

          if (values === undefined || values === null) {
            return true;
          }
          if (typeof values !== 'object' || Array.isArray(values)) {
            return false;
          }

          return Object.values(values as Record<string, unknown>).every(
            (text) => typeof text !== 'string' || text.length <= maxLength,
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `every value of ${args.property}.values must be at most ${maxLength} characters`;
        },
      },
    });
  };
}

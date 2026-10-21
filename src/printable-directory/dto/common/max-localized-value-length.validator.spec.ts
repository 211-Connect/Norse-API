import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePrintableDirectorySectionDto } from '../request/create-printable-directory-section.dto';
import { UpdatePrintableDirectoryDto } from '../request/update-printable-directory.dto';
import {
  PRINTABLE_DIRECTORY_LONG_TEXT_MAX_LENGTH,
  PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH,
} from './max-localized-value-length.validator';

const errorsFor = (
  dto: new () => object,
  raw: Record<string, unknown>,
  property: string,
) =>
  validateSync(plainToInstance(dto, raw)).find(
    (error) => error.property === property,
  );

describe('MaxLocalizedValueLength', () => {
  it('accepts a heading at the limit in every locale', () => {
    const text = 'a'.repeat(PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH);
    expect(
      errorsFor(
        CreatePrintableDirectorySectionDto,
        { headingLocalized: { values: { en: text, es: text } } },
        'headingLocalized',
      ),
    ).toBeUndefined();
  });

  it('rejects a heading over the limit in any locale', () => {
    expect(
      errorsFor(
        CreatePrintableDirectorySectionDto,
        {
          headingLocalized: {
            values: {
              en: 'ok',
              es: 'a'.repeat(PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH + 1),
            },
          },
        },
        'headingLocalized',
      ),
    ).toBeDefined();
  });

  it('rejects a section description over the long limit', () => {
    expect(
      errorsFor(
        CreatePrintableDirectorySectionDto,
        {
          headingLocalized: { values: { en: 'Food' } },
          descriptionLocalized: {
            values: {
              en: 'a'.repeat(PRINTABLE_DIRECTORY_LONG_TEXT_MAX_LENGTH + 1),
            },
          },
        },
        'descriptionLocalized',
      ),
    ).toBeDefined();
  });

  it('applies to the nested cover and footer of an update', () => {
    const errors = validateSync(
      plainToInstance(UpdatePrintableDirectoryDto, {
        cover: {
          titleLocalized: {
            values: {
              en: 'a'.repeat(PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH + 1),
            },
          },
        },
        footer: {
          layout: ['text'],
          textLocalized: {
            values: {
              en: 'a'.repeat(PRINTABLE_DIRECTORY_LONG_TEXT_MAX_LENGTH + 1),
            },
          },
        },
      }),
    );

    expect(errors.map((error) => error.property).sort()).toEqual([
      'cover',
      'footer',
    ]);
  });
});

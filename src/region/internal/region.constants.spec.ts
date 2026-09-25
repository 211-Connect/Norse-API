import { ValidationArguments } from 'class-validator';
import { regionIdMessage } from './region.constants';

describe('regionIdMessage', () => {
  const args = (property: string, value: unknown) =>
    ({ property, value }) as ValidationArguments;

  it('names a single id', () => {
    expect(regionIdMessage(args('id', 'nope'))).toBe(
      'id must be state:XX, county:<5-digit FIPS> or zip:<5 digits>',
    );
  });

  it('names each item of a list', () => {
    expect(regionIdMessage(args('regionIds', ['nope']))).toBe(
      'each value in regionIds must be state:XX, county:<5-digit FIPS> or zip:<5 digits>',
    );
  });
});

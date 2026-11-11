import { toSnakeCaseKeys } from './snake-case';

describe('toSnakeCaseKeys', () => {
  it('converts keys at every depth, through arrays', () => {
    expect(
      toSnakeCaseKeys({
        multiSelect: true,
        options: [{ value: 'N-HOU', resultsCount: 3 }],
        hotlines: [{ label: 'x', number: '1' }],
        noneOfThese: false,
        allowOther: true,
      }),
    ).toEqual({
      multi_select: true,
      options: [{ value: 'N-HOU', results_count: 3 }],
      hotlines: [{ label: 'x', number: '1' }],
      none_of_these: false,
      allow_other: true,
    });
  });

  it('leaves values, including code strings, untouched', () => {
    expect(
      toSnakeCaseKeys({ id: 'area:N-HOU', stemText: 'camelValue' }),
    ).toEqual({ id: 'area:N-HOU', stem_text: 'camelValue' });
  });

  it('passes primitives and null through', () => {
    expect(toSnakeCaseKeys(null)).toBeNull();
    expect(toSnakeCaseKeys(5)).toBe(5);
    expect(toSnakeCaseKeys('aB')).toBe('aB');
  });
});

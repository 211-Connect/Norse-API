import { needDescription, needText } from './need-text';
import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

describe('need text', () => {
  it.each([...SUNE_TIER1, ...SUNE_TIER2].map((e) => [e.code] as const))(
    '%s has a non-empty display and description',
    (code) => {
      const t = needText(code, { locale: 'en' });
      expect(t.display.trim()).not.toBe('');
      expect(t.description.trim()).not.toBe('');
    },
  );

  it('keys by code: N-DIS and N-DIS-01 share a display but not a description', () => {
    expect(needText('N-DIS').display).toBe(needText('N-DIS-01').display);
    expect(needText('N-DIS').description).not.toBe(
      needText('N-DIS-01').description,
    );
  });

  it('returns the SUNE default', () => {
    expect(needText('N-FOD-05').display).toBe('Safe Drinking Water');
  });

  it('gives an unknown code back as display with no description', () => {
    expect(needText('N-ZZZ')).toEqual({ display: 'N-ZZZ', description: '' });
  });
});

describe('needDescription', () => {
  it('English text for English only; no field without a text', () => {
    for (const locale of [undefined, 'en', 'EN', 'en-US', 'en_GB'])
      expect(needDescription('N-HOU', { locale }).description).toBeTruthy();
    // Not a tag of English (the matcher every other locale check uses).
    for (const locale of ['es', 'es-MX', 'ru', 'enm', 'en,es', 'en;q=0.1'])
      expect(needDescription('N-HOU', { locale })).toEqual({});
    expect(needDescription('N-ZZZ', { locale: 'en' })).toEqual({});
  });
});

import { needDescription, needText, setNeedTextOverride } from './need-text';
import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

describe('need text', () => {
  afterEach(() => setNeedTextOverride(null));

  it.each([...SUNE_TIER1, ...SUNE_TIER2].map((e) => [e.code] as const))(
    '%s has a non-empty display and description',
    (code) => {
      const t = needText(code, { tenantId: 't', locale: 'en' });
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

  it('returns the SUNE default with no override', () => {
    expect(needText('N-FOD-05').display).toBe('Safe Drinking Water');
  });

  it('prefers an override when given, field by field', () => {
    const ov = (code: string, ctx: { tenantId?: string; locale?: string }) =>
      code === 'N-FOD-05' && ctx.tenantId === 'acme'
        ? { display: 'Clean Water', description: '' }
        : null;
    const t = needText('N-FOD-05', { tenantId: 'acme', locale: 'en' }, ov);
    expect(t.display).toBe('Clean Water');
    expect(t.description).toBe(needText('N-FOD-05').description); // empty override field falls back
    expect(needText('N-FOD-05', { tenantId: 'other' }, ov).display).toBe(
      'Safe Drinking Water',
    );
  });

  it('uses the process-wide override once set', () => {
    setNeedTextOverride((code) =>
      code === 'N-HOU' ? { display: 'Home' } : null,
    );
    expect(needText('N-HOU').display).toBe('Home');
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

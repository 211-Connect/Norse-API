import {
  MAX_V2_QUERY_LENGTH,
  assertV2QueryLength,
  describeQueryForLog,
} from './query-log';

describe('describeQueryForLog', () => {
  it('reports length, a 12-hex fingerprint and the first 40 characters', () => {
    const text = 'x'.repeat(5000);
    const out = describeQueryForLog(text);
    expect(out).toMatch(/^len=5000 id=[0-9a-f]{12} start="x{40}"$/);
    expect(out).not.toContain('x'.repeat(41));
  });

  it('gives the same fingerprint for the same query and another for a different one', () => {
    const id = (q: string) =>
      /id=([0-9a-f]{12})/.exec(describeQueryForLog(q))![1];
    expect(id('food bank near me')).toBe(id('food bank near me'));
    expect(id('food bank near me')).not.toBe(id('food bank near you'));
  });

  it('keeps a short query whole in the start field', () => {
    expect(describeQueryForLog('rent help')).toMatch(
      /^len=9 id=[0-9a-f]{12} start="rent help"$/,
    );
  });

  it('does not cut a character in two, and counts characters not bytes', () => {
    const out = describeQueryForLog('😀'.repeat(50));
    expect(out).toContain('len=50 ');
    expect(out).toContain(`start="${'😀'.repeat(40)}"`);
  });

  it('keeps line breaks and quotes from forging log lines', () => {
    const out = describeQueryForLog('a\nb"c');
    expect(out).not.toContain('\n');
    expect(out).toContain('start="a b\\"c"');
  });

  it('handles an empty query', () => {
    expect(describeQueryForLog('')).toMatch(/^len=0 id=[0-9a-f]{12} start=""$/);
  });
});

describe('assertV2QueryLength', () => {
  it('accepts a query of exactly the limit', () => {
    expect(() =>
      assertV2QueryLength('a'.repeat(MAX_V2_QUERY_LENGTH)),
    ).not.toThrow();
  });

  it('rejects a longer query with a 400 that asks for a short description', () => {
    try {
      assertV2QueryLength('a'.repeat(MAX_V2_QUERY_LENGTH + 1));
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e.getStatus()).toBe(400);
      expect(e.message).toMatch(/500 characters/);
      expect(e.message).toMatch(/short description of the need/);
      expect(e.message).toMatch(/not a transcript/);
    }
  });
});

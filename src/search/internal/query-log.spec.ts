import {
  MAX_QUERY_LENGTH,
  assertQueryLength,
  describeQueryForLog,
} from './query-log';

describe('describeQueryForLog', () => {
  it('reports length and a 12-hex fingerprint, nothing of the text', () => {
    const out = describeQueryForLog('x'.repeat(5000));
    expect(out).toMatch(/^len=5000 id=[0-9a-f]{12}$/);
  });

  it('gives the same fingerprint for the same query and another for a different one', () => {
    const id = (q: string) =>
      /id=([0-9a-f]{12})/.exec(describeQueryForLog(q))![1];
    expect(id('food bank near me')).toBe(id('food bank near me'));
    expect(id('food bank near me')).not.toBe(id('food bank near you'));
  });

  it('does not print a short query either', () => {
    const out = describeQueryForLog('rent help');
    expect(out).toMatch(/^len=9 id=[0-9a-f]{12}$/);
    expect(out).not.toContain('rent');
  });

  it('counts UTF-16 units, like Elasticsearch', () => {
    expect(describeQueryForLog('😀'.repeat(50))).toContain('len=100 ');
  });

  it('cannot forge log lines with line breaks or quotes', () => {
    expect(describeQueryForLog('a\nb"c')).toMatch(/^len=5 id=[0-9a-f]{12}$/);
  });

  it('handles an empty query', () => {
    expect(describeQueryForLog('')).toMatch(/^len=0 id=[0-9a-f]{12}$/);
  });
});

describe('assertQueryLength', () => {
  it('accepts a query of exactly the limit', () => {
    expect(() => assertQueryLength('a'.repeat(MAX_QUERY_LENGTH))).not.toThrow();
  });

  it('rejects a longer query with a 400 that asks for a short description', () => {
    try {
      assertQueryLength('a'.repeat(MAX_QUERY_LENGTH + 1));
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e.getStatus()).toBe(400);
      expect(e.message).toMatch(/500 characters/);
      expect(e.message).toMatch(/short description of the need/);
      expect(e.message).toMatch(/not a transcript/);
    }
  });

  it('counts UTF-16 units: 251 emoji (502 units) are rejected', () => {
    expect(() => assertQueryLength('😀'.repeat(250))).not.toThrow();
    expect(() => assertQueryLength('😀'.repeat(251))).toThrow();
  });
});

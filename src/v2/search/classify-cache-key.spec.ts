import { classifyCacheKey } from './classify-cache-key';

describe('classifyCacheKey', () => {
  it('has the versioned format with a sha256 hex tail', () => {
    expect(classifyCacheKey('t1', 'on', 'rent help')).toMatch(
      /^classify:v2:t1:on:unknown:[0-9a-f]{64}$/,
    );
  });
  it('differs by tenant', () => {
    expect(classifyCacheKey('t1', 'on', 'rent help')).not.toBe(
      classifyCacheKey('t2', 'on', 'rent help'),
    );
  });
  it('differs by ai setting', () => {
    expect(classifyCacheKey('t1', 'on', 'rent help')).not.toBe(
      classifyCacheKey('t1', 'off', 'rent help'),
    );
  });
  it('is the same for text that normalizes the same', () => {
    expect(classifyCacheKey('t1', 'on', ' rent  help ')).toBe(
      classifyCacheKey('t1', 'on', 'rent help'),
    );
  });
  it('holds no search text', () => {
    const key = classifyCacheKey('t1', 'on', 'very private words');
    expect(key).not.toContain('private');
    expect(key).not.toContain('words');
  });
  it('puts the model version in the key and differs by it', () => {
    const a = classifyCacheKey('t1', 'on', 'rent help', 'mv-1');
    expect(a).toMatch(/^classify:v2:t1:on:mv-1:[0-9a-f]{64}$/);
    expect(a).not.toBe(classifyCacheKey('t1', 'on', 'rent help', 'mv-2'));
    expect(a).not.toBe(classifyCacheKey('t1', 'on', 'rent help'));
  });
  it('cleans odd characters out of the model version', () => {
    expect(classifyCacheKey('t1', 'on', 'x', 'a:b c')).toContain(':a_b_c:');
  });
});

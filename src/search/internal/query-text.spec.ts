import { normalizeQueryText } from './query-text';

describe('normalizeQueryText', () => {
  it('trims edge whitespace', () => {
    expect(normalizeQueryText('  food bank \n')).toBe('food bank');
  });
  it('collapses spaces, tabs and newlines to one space', () => {
    expect(normalizeQueryText('  food \t\n bank ')).toBe('food bank');
  });
  it('keeps case', () => {
    expect(normalizeQueryText('AIDS')).toBe('AIDS');
  });
  it('is idempotent', () => {
    const once = normalizeQueryText(' a   b\tc ');
    expect(normalizeQueryText(once)).toBe(once);
  });
  it('maps empty and whitespace-only text to an empty string', () => {
    expect(normalizeQueryText('')).toBe('');
    expect(normalizeQueryText(' \t\n ')).toBe('');
  });
});

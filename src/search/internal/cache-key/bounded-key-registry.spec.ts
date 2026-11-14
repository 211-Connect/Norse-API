import { BoundedKeyRegistry } from './bounded-key-registry';

describe('BoundedKeyRegistry', () => {
  it('returns no evictions while under the cap', () => {
    const r = new BoundedKeyRegistry(3);
    expect(r.add(['a', 'b', 'c'])).toEqual([]);
    expect(r.size).toBe(3);
  });

  it('evicts the oldest keys first when the cap is passed', () => {
    const r = new BoundedKeyRegistry(3);
    r.add(['a', 'b', 'c']);
    expect(r.add(['d', 'e'])).toEqual(['a', 'b']);
    expect(r.size).toBe(3);
  });

  it('a re-added key counts as new and is evicted last', () => {
    const r = new BoundedKeyRegistry(3);
    r.add(['a', 'b', 'c']);
    r.add(['a']);
    expect(r.add(['d'])).toEqual(['b']);
  });

  it('holds the cap over many writes', () => {
    const r = new BoundedKeyRegistry(10);
    for (let i = 0; i < 100; i++) r.add([`k${i}`]);
    expect(r.size).toBe(10);
  });
});

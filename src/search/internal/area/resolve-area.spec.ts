import { resolveArea } from './resolve-area';

const regionService = { getSummaries: jest.fn(async () => []) };
const query = (extra: Record<string, unknown> = {}) =>
  ({ region: ['county:53033'], ...extra }) as any;
const run = (
  config: Record<string, unknown>,
  q: Record<string, unknown> = {},
  opts?: { rankingVersion?: 'v1' | 'v2' },
) => resolveArea(query(q), regionService, async () => config, opts);

describe('resolveArea unlocated default', () => {
  it.each(['all', 'none'] as const)(
    'tenant %s: v1 uses it, v2 uses virtual',
    async (value) => {
      const cfg = { unlocated_in_area_search: value };
      expect((await run(cfg)).area?.unlocated).toBe(value);
      expect(
        (await run(cfg, {}, { rankingVersion: 'v1' })).area?.unlocated,
      ).toBe(value);
      expect(
        (await run(cfg, {}, { rankingVersion: 'v2' })).area?.unlocated,
      ).toBe('virtual');
    },
  );

  it('legacy boolean true: v1 all, v2 virtual', async () => {
    const cfg = { include_unlocated_in_area_search: true };
    expect((await run(cfg)).area?.unlocated).toBe('all');
    expect((await run(cfg, {}, { rankingVersion: 'v2' })).area?.unlocated).toBe(
      'virtual',
    );
  });

  it('a caller unlocated wins in both versions', async () => {
    const cfg = { unlocated_in_area_search: 'none' };
    for (const rankingVersion of ['v1', 'v2'] as const) {
      expect(
        (await run(cfg, { unlocated: 'all' }, { rankingVersion })).area
          ?.unlocated,
      ).toBe('all');
    }
  });

  it('resolved.unlocated echoes the v2 value; area_match keeps the tenant default', async () => {
    const out = await run(
      { unlocated_in_area_search: 'all', area_match: 'located' },
      {},
      { rankingVersion: 'v2' },
    );
    expect(out.resolved?.unlocated).toBe('virtual');
    expect(out.area?.match).toBe('located');
  });
});

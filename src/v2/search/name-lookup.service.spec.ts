import { ElasticsearchService } from '@nestjs/elasticsearch';
import { MATCH } from '../rules/match';
import { NameLookupService } from './name-lookup.service';

const build = (search: jest.Mock) =>
  new NameLookupService({ search } as unknown as ElasticsearchService);

const hit = (org: unknown) => ({ _source: { organization: org } });

describe('NameLookupService', () => {
  it('sends one read-only search with the plan request shape', async () => {
    const search = jest.fn().mockResolvedValue({ hits: { hits: [] } });
    await build(search).lookup('t-1', 'idx_en', 'red cross');
    expect(search).toHaveBeenCalledTimes(1);
    const [req, opts] = search.mock.calls[0];
    expect(opts).toEqual({ requestTimeout: 800 });
    expect(req).toMatchObject({
      index: 'idx_en',
      size: MATCH.nameLookupSize,
      timeout: '500ms',
      track_total_hits: false,
      collapse: { field: 'organization.id' },
      _source: [
        'organization.id',
        'organization.name',
        'organization.alternate_name',
      ],
    });
    expect(req.query.bool.filter).toEqual([{ term: { tenant_id: 't-1' } }]);
    expect(req.query.bool.minimum_should_match).toBe(1);
    expect(req.query.bool.should).toEqual([
      {
        match_phrase: {
          'organization.name': { query: 'red cross', boost: 12 },
        },
      },
      {
        match: {
          'organization.name': {
            query: 'red cross',
            operator: 'and',
            boost: 4,
          },
        },
      },
      {
        match_phrase: {
          'organization.alternate_name': { query: 'red cross', boost: 8 },
        },
      },
    ]);
  });

  it('maps hits: alternate_name string split on ;, array, null; skips bad hits', async () => {
    const search = jest.fn().mockResolvedValue({
      hits: {
        hits: [
          hit({ id: 'a', name: 'A Org', alternate_name: 'One; Two ;' }),
          hit({ id: 'b', name: 'B Org', alternate_name: ['Bee', 5] }),
          hit({ id: 'c', name: 'C Org', alternate_name: null }),
          hit({ name: 'No Id' }),
          hit({ id: 'd' }),
          { _source: {} },
        ],
      },
    });
    expect(await build(search).lookup('t', 'i', 'x')).toEqual([
      { id: 'a', name: 'A Org', alternate_names: ['One', 'Two'] },
      { id: 'b', name: 'B Org', alternate_names: ['Bee'] },
      { id: 'c', name: 'C Org', alternate_names: [] },
    ]);
  });

  it('an error gives null and the log has no query text', async () => {
    const search = jest.fn().mockRejectedValue(new Error('boom secret-words'));
    const svc = build(search);
    const warn = jest
      .spyOn(
        (svc as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    expect(await svc.lookup('t', 'i', 'secret-words')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-words');
  });

  it('with coords sorts by distance, so the nearest orgs fill the slots; without coords no sort', async () => {
    const search = jest.fn().mockResolvedValue({ hits: { hits: [] } });
    await build(search).lookup('t', 'i', 'catholic charities', [-87.63, 41.88]);
    await build(search).lookup('t', 'i', 'catholic charities');
    const [withCoords] = search.mock.calls[0];
    const [without] = search.mock.calls[1];
    expect(withCoords.sort[0]._geo_distance['location.point']).toEqual({
      lon: -87.63,
      lat: 41.88,
    });
    expect(without).not.toHaveProperty('sort');
  });

  it('a timed-out or shard-failed answer (HTTP 200, partial hits) gives null, not an empty list', async () => {
    const timedOut = jest
      .fn()
      .mockResolvedValue({ timed_out: true, hits: { hits: [] } });
    expect(await build(timedOut).lookup('t', 'i', 'x')).toBeNull();
    const shards = jest.fn().mockResolvedValue({
      _shards: { failed: 1 },
      hits: { hits: [] },
    });
    expect(await build(shards).lookup('t', 'i', 'x')).toBeNull();
  });
});

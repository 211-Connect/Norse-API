import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import { RegionService } from './region.service';
import { EXACT_STATE_BOOST, NEAR_STATE_BOOST } from './region.query';

const JACKSON = {
  id: 'county:29095',
  type: 'county',
  name: 'Jackson County, MO',
  state: 'MO',
  fips: '29095',
  zip: null,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  attribution: { text: 'County data © simplemaps.com, CC BY 4.0', url: 'u' },
};

describe('RegionService', () => {
  const search = jest.fn();
  const elasticsearch = { search } as unknown as ElasticsearchService;
  let service: RegionService;
  const lastRequest = () => search.mock.calls[search.mock.calls.length - 1][0];
  const hits = (...sources: object[]) => ({
    hits: { hits: sources.map((s) => ({ _source: s })) },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RegionService(elasticsearch);
    search.mockResolvedValue(hits());
  });

  describe('search: digits search ZIPs by prefix', () => {
    it.each(['6', '641', '64130'])('%s → zip prefix, zip order', async (q) => {
      await service.search({ q });
      const req = lastRequest();
      expect(req.index).toBe('regions');
      expect(req.query).toEqual({
        bool: {
          filter: [{ term: { type: 'zip' } }, { prefix: { zip: q } }],
        },
      });
      expect(req.sort).toEqual([{ zip: { order: 'asc' } }]);
      expect(JSON.stringify(req)).not.toMatch(/multi_match|_score/);
    });

    it('six digits is not a ZIP prefix; it searches names', async () => {
      await service.search({ q: '641301' });
      expect(lastRequest().query.bool.must[0].multi_match.query).toBe('641301');
    });

    it('answers digits with nothing when the types exclude zip, without calling ES', async () => {
      const result = await service.search({ q: '641', types: ['county'] });
      expect(result).toEqual({ items: [] });
      expect(search).not.toHaveBeenCalled();
    });

    it('still searches ZIPs when types include zip', async () => {
      await service.search({ q: '641', types: ['county', 'zip'] });
      expect(search).toHaveBeenCalledTimes(1);
    });
  });

  describe('search: text searches names', () => {
    it('uses bool_prefix over the search_as_you_type subfields, score then id', async () => {
      await service.search({ q: '  jackson mo ' });
      const req = lastRequest();
      expect(req.query.bool.must).toEqual([
        {
          multi_match: {
            query: 'jackson mo',
            type: 'bool_prefix',
            fields: ['name', 'name._2gram', 'name._3gram'],
            operator: 'and',
          },
        },
      ]);
      expect(req.query.bool.filter).toEqual([]);
      expect(req.query.bool.should).toEqual([]);
      expect(req.sort).toEqual([
        { _score: { order: 'desc' } },
        { id: { order: 'asc' } },
      ]);
    });

    it('filters by the requested types', async () => {
      await service.search({ q: 'jack', types: ['state', 'county'] });
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { type: ['state', 'county'] } },
      ]);
    });

    it.each([
      ['MO', 'MO'],
      ['mo', 'MO'],
      ['Missouri', 'MO'],
      ['  new   york ', 'NY'],
      ['DC', 'DC'],
      ['district of columbia', 'DC'],
    ])('boosts the state itself for %j', async (q, code) => {
      await service.search({ q });
      const must = lastRequest().query.bool.must[0];
      expect(must.bool.minimum_should_match).toBe(1);
      expect(must.bool.should[1]).toEqual({
        term: { id: { value: `state:${code}`, boost: EXACT_STATE_BOOST } },
      });
      expect(must.bool.should[0].multi_match.query).toBe(q.trim());
    });

    it.each(['jackson mo', 'miss', 'kansas city', 'm'])(
      'does not boost a state for partial text %j',
      async (q) => {
        await service.search({ q });
        expect(JSON.stringify(lastRequest())).not.toContain('state:');
      },
    );

    it('biases (does not filter) toward the given states', async () => {
      await service.search({ q: 'jack', states: ['MO', 'KS'] });
      const { bool } = lastRequest().query;
      expect(bool.should).toEqual([
        { terms: { state: ['MO', 'KS'], boost: NEAR_STATE_BOOST } },
      ]);
      expect(JSON.stringify(bool.filter)).not.toContain('MO');
      expect(bool.minimum_should_match).toBeUndefined();
    });
  });

  describe('search: response', () => {
    it('asks ES for summary fields only, never geometry', async () => {
      await service.search({ q: 'jack' });
      expect(lastRequest()._source).toEqual(['id', 'type', 'name', 'state']);
      await service.search({ q: '641' });
      expect(lastRequest()._source).toEqual(['id', 'type', 'name', 'state']);
    });

    it('maps hits to {id, type, name, state} only', async () => {
      search.mockResolvedValue(hits(JACKSON));
      const result = await service.search({ q: 'jack' });
      expect(result).toEqual({
        items: [
          {
            id: 'county:29095',
            type: 'county',
            name: 'Jackson County, MO',
            state: 'MO',
          },
        ],
      });
    });

    it('defaults the limit to 10 and passes an explicit one through', async () => {
      await service.search({ q: 'jack' });
      expect(lastRequest().size).toBe(10);
      await service.search({ q: '641', limit: 25 });
      expect(lastRequest().size).toBe(25);
    });
  });

  describe('get', () => {
    it('looks the Region up by exact id', async () => {
      search.mockResolvedValue(hits(JACKSON));
      await service.get('county:29095');
      const req = lastRequest();
      expect(req.index).toBe('regions');
      expect(req.query).toEqual({ term: { id: 'county:29095' } });
      expect(req._source).toEqual(
        expect.arrayContaining(['geometry', 'attribution', 'fips', 'zip']),
      );
    });

    it('returns boundary and attribution, omitting absent fields', async () => {
      search.mockResolvedValue(hits(JACKSON));
      expect(await service.get('county:29095')).toEqual({
        id: 'county:29095',
        type: 'county',
        name: 'Jackson County, MO',
        state: 'MO',
        fips: '29095',
        geometry: JACKSON.geometry,
        attribution: JACKSON.attribution,
      });
    });

    it('404s an unknown id', async () => {
      await expect(service.get('county:99999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('downstream failures', () => {
    it('maps a timeout to 503', async () => {
      search.mockRejectedValue(new errors.TimeoutError('slow'));
      await expect(service.search({ q: 'jack' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('maps any other failure to 502', async () => {
      search.mockRejectedValue(new Error('boom'));
      await expect(service.get('state:MO')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });
});

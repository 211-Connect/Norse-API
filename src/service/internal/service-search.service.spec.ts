import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import { RegionService } from '../../region/internal';
import {
  FACET_PAGE_SIZE,
  ServiceSearchService,
} from './service-search.service';

const WRITER_A = 'writer-a';
const WRITER_B = 'writer-b';

describe('ServiceSearchService', () => {
  const search = jest.fn();
  const mget = jest.fn();
  const elasticsearch = { search, mget } as unknown as ElasticsearchService;
  let service: ServiceSearchService;

  const emptyPage = { hits: { total: { value: 0 }, hits: [] } };
  const lastRequest = () => search.mock.calls[search.mock.calls.length - 1][0];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ServiceSearchService(
      elasticsearch,
      new RegionService(elasticsearch),
    );
    search.mockResolvedValue(emptyPage);
    mget.mockImplementation(async ({ ids }: { ids: string[] }) => ({
      docs: ids.map((_id) => ({ _index: 'regions_v1', _id, found: true })),
    }));
  });

  const regionClause = (...ids: string[]) => ({
    bool: {
      should: ids.map((id) => ({
        geo_shape: {
          service_area: {
            indexed_shape: { index: 'regions', id, path: 'geometry' },
            relation: 'intersects',
          },
        },
      })),
      minimum_should_match: 1,
    },
  });
  // ADR 0025: a Virtual Service with no Service Area serves every Region.
  const globalVirtual = {
    bool: {
      filter: [{ term: { locationTypes: 'virtual' } }],
      must_not: [{ exists: { field: 'service_area' } }],
    },
  };
  const servesClause = (...ids: string[]) => {
    const regions = regionClause(...ids);
    return {
      bool: {
        ...regions.bool,
        should: [...regions.bool.should, globalVirtual],
      },
    };
  };
  const missingShapeError = (id: string) =>
    new errors.ResponseError({
      statusCode: 400,
      body: {
        error: {
          root_cause: [
            {
              type: 'illegal_argument_exception',
              reason: `Shape with ID [${id}] not found`,
            },
          ],
          type: 'illegal_argument_exception',
          reason: `Shape with ID [${id}] not found`,
        },
        status: 400,
      },
      headers: {},
      warnings: null,
      meta: {} as never,
    });

  describe('search', () => {
    it('scopes to the writer set, canonical publications and a usable serviceId', async () => {
      await service.search({ resourceWriterIds: [WRITER_A, WRITER_B] });
      const { query, index } = lastRequest();
      expect(index).toBe('services');
      expect(query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A, WRITER_B] } },
        { exists: { field: 'serviceId' } },
      ]);
      expect(query.bool.must_not).toEqual([
        { term: { isCanonicalPublication: false } },
        { term: { serviceId: '' } },
      ]);
      expect(query.bool.must).toEqual([]);
    });

    it('answers an empty writer set with nothing, never an unscoped query', async () => {
      const result = await service.search({ resourceWriterIds: [] });
      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        nextCursor: null,
      });
      expect(search).not.toHaveBeenCalled();
    });

    it('matches taxonomy codes exactly against the expanded path, and statuses by value', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { taxonomyCodes: ['BD-1800'], statuses: ['active'] },
      });
      const { query } = lastRequest();
      expect(query.bool.filter).toEqual(
        expect.arrayContaining([
          { terms: { taxonomyPath: ['BD-1800'] } },
          { terms: { status: ['active'] } },
        ]),
      );
      expect(JSON.stringify(query)).not.toMatch(/prefix|wildcard/);
    });

    it('treats empty clauses as no constraint', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { taxonomyCodes: [], statuses: [] },
      });
      expect(lastRequest().query.bool.filter).toHaveLength(2);
    });

    it('matches text by name contains, OR a multi_match weighted to name', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        text: '  food bank ',
      });
      expect(lastRequest().query.bool.must).toEqual([
        {
          bool: {
            should: [
              {
                wildcard: {
                  'name.substring': {
                    value: '*food bank*',
                    case_insensitive: true,
                  },
                },
              },
              {
                multi_match: {
                  query: 'food bank',
                  type: 'bool_prefix',
                  fields: [
                    'name^3',
                    'alternateName',
                    'description',
                    'organizationName',
                  ],
                  operator: 'and',
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      ]);
    });

    it('escapes wildcard metacharacters in the text', async () => {
      await service.search({ resourceWriterIds: [WRITER_A], text: 'a*b?c\\d' });
      const wildcard =
        lastRequest().query.bool.must[0].bool.should[0].wildcard[
          'name.substring'
        ];
      expect(wildcard.value).toBe('*a\\*b\\?c\\\\d*');
    });

    it('ignores blank text', async () => {
      await service.search({ resourceWriterIds: [WRITER_A], text: '   ' });
      expect(lastRequest().query.bool.must).toEqual([]);
    });

    it('orders by name then serviceId without text', async () => {
      await service.search({ resourceWriterIds: [WRITER_A] });
      expect(lastRequest().sort).toEqual([
        { 'name.raw': { order: 'asc', missing: '_first' } },
        { serviceId: { order: 'asc' } },
      ]);
    });

    it('orders by score then serviceId with text', async () => {
      await service.search({ resourceWriterIds: [WRITER_A], text: 'food' });
      expect(lastRequest().sort).toEqual([
        { _score: { order: 'desc' } },
        { serviceId: { order: 'asc' } },
      ]);
    });

    it('asks for one extra hit, never uses from, and counts every match', async () => {
      await service.search({ resourceWriterIds: [WRITER_A], limit: 25 });
      const request = lastRequest();
      expect(request.size).toBe(26);
      expect(request.from).toBeUndefined();
      expect(request.search_after).toBeUndefined();
      expect(request.track_total_hits).toBe(true);
    });

    describe('cursor', () => {
      const hit = (serviceId: string, sort: unknown[]) => ({
        _id: `t:${serviceId}`,
        _source: { serviceId },
        sort,
      });

      it('returns the last kept hit as nextCursor and resumes after it', async () => {
        search.mockResolvedValueOnce({
          hits: {
            total: { value: 3 },
            hits: [
              hit('s1', ['Alpha', 's1']),
              hit('s2', [null, 's2']),
              hit('s3', ['Gamma', 's3']),
            ],
          },
        });
        const first = await service.search({
          resourceWriterIds: [WRITER_A],
          limit: 2,
        });
        expect(first.items.map((i) => i.serviceId)).toEqual(['s1', 's2']);
        expect(first.nextCursor).toEqual(expect.any(String));

        await service.search({
          resourceWriterIds: [WRITER_A],
          limit: 2,
          cursor: first.nextCursor!,
        });
        expect(lastRequest().search_after).toEqual([null, 's2']);
      });

      it('returns a null cursor on the last page', async () => {
        search.mockResolvedValueOnce({
          hits: { total: { value: 2 }, hits: [hit('s1', ['A', 's1'])] },
        });
        const page = await service.search({
          resourceWriterIds: [WRITER_A],
          limit: 2,
        });
        expect(page.nextCursor).toBeNull();
      });

      const issue = async (text?: string) => {
        search.mockResolvedValueOnce({
          hits: {
            total: { value: 2 },
            hits: [
              hit('s1', text ? [2.5, 's1'] : ['A', 's1']),
              hit('s2', text ? [1.5, 's2'] : ['B', 's2']),
            ],
          },
        });
        const page = await service.search({
          resourceWriterIds: [WRITER_A],
          limit: 1,
          text,
        });
        search.mockClear();
        return page.nextCursor!;
      };
      const reencode = (cursor: string, edit: (p: any) => void) => {
        const payload = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        edit(payload);
        return Buffer.from(JSON.stringify(payload)).toString('base64url');
      };

      it.each([
        ['not base64 JSON', () => Promise.resolve('!!!not-a-cursor')],
        [
          'a sort value of the wrong type',
          async () => reencode(await issue(), (p) => (p.s = [1, 's1'])),
        ],
        [
          'a missing tie-breaker',
          async () => reencode(await issue(), (p) => (p.s = ['A'])),
        ],
        [
          'an unknown version',
          async () => reencode(await issue(), (p) => (p.v = 2)),
        ],
        [
          'an edited query fingerprint',
          async () => reencode(await issue(), (p) => (p.k = '0'.repeat(16))),
        ],
      ])('rejects %s with 400', async (_label, make) => {
        const cursor = await make();
        await expect(
          service.search({ resourceWriterIds: [WRITER_A], cursor }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(search).not.toHaveBeenCalled();
      });

      it('rejects a cursor replayed against a different query', async () => {
        const cursor = await issue();
        await expect(
          service.search({ resourceWriterIds: [WRITER_B], cursor }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.search({
            resourceWriterIds: [WRITER_A],
            filter: { statuses: ['active'] },
            cursor,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(search).not.toHaveBeenCalled();
      });

      it('rejects a name-order cursor on a text search, and the reverse', async () => {
        const nameCursor = await issue();
        await expect(
          service.search({
            resourceWriterIds: [WRITER_A],
            text: 'x',
            cursor: nameCursor,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        const scoreCursor = await issue('food');
        await expect(
          service.search({
            resourceWriterIds: [WRITER_A],
            cursor: scoreCursor,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('accepts a score cursor for the same text search', async () => {
        const cursor = await issue('food');
        await service.search({
          resourceWriterIds: [WRITER_A],
          text: ' food ',
          cursor,
        });
        expect(lastRequest().search_after).toEqual([2.5, 's1']);
      });
    });

    describe('shard-copy preference', () => {
      const scored = (serviceId: string, score: number) => ({
        _id: `t:${serviceId}`,
        _source: { serviceId },
        sort: [score, serviceId],
      });

      /** Walks three pages of one text query; returns each request sent. */
      const walk = async (request: {
        resourceWriterIds: string[];
        text?: string;
        filter?: { statuses?: string[] };
      }) => {
        search.mockClear();
        const pages = [
          [scored('s1', 3), scored('s2', 2)],
          [scored('s2', 2), scored('s3', 1)],
          [scored('s3', 1)],
        ];
        let cursor: string | undefined;
        for (const hits of pages) {
          search.mockResolvedValueOnce({ hits: { total: { value: 3 }, hits } });
          const page = await service.search({
            ...request,
            text: request.text ?? 'food pantry',
            limit: 1,
            cursor,
          });
          cursor = page.nextCursor ?? undefined;
        }
        return search.mock.calls.map(([body]) => body);
      };

      it('pins every page of one query, the first included, to the same shard copies', async () => {
        const requests = await walk({ resourceWriterIds: [WRITER_A] });
        expect(requests).toHaveLength(3);
        const preferences = requests.map((r) => r.preference);
        expect(preferences[0]).toEqual(expect.any(String));
        expect(preferences[0]).not.toMatch(/^_/);
        expect(new Set(preferences).size).toBe(1);
      });

      it('sends a preference on a name-order search too', async () => {
        await service.search({ resourceWriterIds: [WRITER_A] });
        expect(lastRequest().preference).toEqual(expect.any(String));
      });

      it('uses a different preference for a different query', async () => {
        const [base] = await walk({ resourceWriterIds: [WRITER_A] });
        const [otherText] = await walk({
          resourceWriterIds: [WRITER_A],
          text: 'food*',
        });
        const [otherWriters] = await walk({ resourceWriterIds: [WRITER_B] });
        const [otherFilter] = await walk({
          resourceWriterIds: [WRITER_A],
          filter: { statuses: ['active'] },
        });
        const preferences = [base, otherText, otherWriters, otherFilter].map(
          (r) => r.preference,
        );
        expect(new Set(preferences).size).toBe(4);
      });
    });

    it('returns list-row fields and the total', async () => {
      search.mockResolvedValue({
        hits: {
          total: { value: 27_686, relation: 'eq' },
          hits: [
            {
              _id: 't1:s1',
              _source: {
                serviceId: 's1',
                tenant_id: 't1',
                resourceWriterId: WRITER_A,
                status: 'active',
                taxonomyPath: ['BD-1800', 'BD'],
                taxonomyCodes: ['BD-1800'],
                locationTypes: ['physical'],
                name: 'Food Bank',
                organizationName: 'Harvesters',
                city: 'Kansas City',
                assuredDate: '2026-01-02',
              },
            },
          ],
        },
      });
      const result = await service.search({ resourceWriterIds: [WRITER_A] });
      expect(result.total).toBe(27_686);
      expect(result.items).toEqual([
        {
          id: 't1:s1',
          serviceId: 's1',
          tenantId: 't1',
          resourceWriterId: WRITER_A,
          isCanonicalPublication: true,
          status: 'active',
          taxonomyPath: ['BD-1800', 'BD'],
          taxonomyCodes: ['BD-1800'],
          locationTypes: ['physical'],
          name: 'Food Bank',
          alternateName: null,
          description: null,
          organizationName: 'Harvesters',
          city: 'Kansas City',
          assuredDate: '2026-01-02',
        },
      ]);
      expect(lastRequest()._source).not.toContain('service_area');
    });

    it('maps an ES timeout to 503 and any other failure to 502', async () => {
      search.mockRejectedValueOnce(new errors.TimeoutError('slow'));
      await expect(
        service.search({ resourceWriterIds: [WRITER_A] }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      search.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.search({ resourceWriterIds: [WRITER_A] }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('facets', () => {
    const composite = (buckets: [string, number][], afterKey?: string) => ({
      buckets: buckets.map(([key, doc_count]) => ({ key: { key }, doc_count })),
      ...(afterKey ? { after_key: { key: afterKey } } : {}),
    });

    it('answers an empty writer set with no options, never an unscoped aggregate', async () => {
      await expect(service.facets({ resourceWriterIds: [] })).resolves.toEqual({
        contributors: [],
        statuses: [],
        taxonomy: [],
      });
      expect(search).not.toHaveBeenCalled();
    });

    it('aggregates under the same scope as the listing', async () => {
      search.mockResolvedValue({ aggregations: {} });
      await service.facets({ resourceWriterIds: [WRITER_A] });
      const request = lastRequest();
      expect(request.size).toBe(0);
      expect(request.query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
      ]);
      expect(request.query.bool.must_not).toEqual([
        { term: { isCanonicalPublication: false } },
        { term: { serviceId: '' } },
      ]);
    });

    it('returns contributor, status and taxonomy counts in the Mongo shapes', async () => {
      search.mockResolvedValue({
        aggregations: {
          contributors: composite([
            [WRITER_B, 2],
            [WRITER_A, 5],
          ]),
          statuses: composite([
            ['inactive', 1],
            ['', 2],
            ['active', 4],
          ]),
          taxonomyPath: composite([
            ['BD-1800', 3],
            ['BD', 4],
            ['BD-1800.2000', 1],
          ]),
          taxonomyCodes: composite([
            ['BD-1800.', 2],
            ['BD-1800.2000', 1],
          ]),
        },
      });

      await expect(
        service.facets({ resourceWriterIds: [WRITER_A, WRITER_B] }),
      ).resolves.toEqual({
        contributors: [
          { resourceWriterId: WRITER_A, recordCount: 5 },
          { resourceWriterId: WRITER_B, recordCount: 2 },
        ],
        statuses: [
          { value: 'active', recordCount: 4 },
          { value: 'inactive', recordCount: 1 },
        ],
        taxonomy: [
          {
            code: 'BD',
            name: 'BD',
            parentCode: null,
            recordCount: 4,
            synthesized: true,
          },
          {
            code: 'BD-1800',
            name: 'BD-1800',
            parentCode: 'BD',
            recordCount: 3,
            synthesized: false,
          },
          {
            code: 'BD-1800.2000',
            name: 'BD-1800.2000',
            parentCode: 'BD-1800',
            recordCount: 1,
            synthesized: false,
          },
        ],
      });
    });

    it('pages a facet until exhausted instead of truncating it', async () => {
      const fullPage = Array.from(
        { length: FACET_PAGE_SIZE },
        (_, i) => [`AA-${i}`, 1] as [string, number],
      );
      search
        .mockResolvedValueOnce({
          aggregations: {
            contributors: composite([[WRITER_A, 1001]]),
            statuses: composite([]),
            taxonomyPath: composite(fullPage, 'AA-999'),
            taxonomyCodes: composite([]),
          },
        })
        .mockResolvedValueOnce({
          aggregations: { taxonomyPath: composite([['ZZ', 1001]]) },
        });

      const result = await service.facets({ resourceWriterIds: [WRITER_A] });

      expect(search).toHaveBeenCalledTimes(2);
      const second = lastRequest();
      expect(Object.keys(second.aggs)).toEqual(['taxonomyPath']);
      expect(second.aggs.taxonomyPath.composite.after).toEqual({
        key: 'AA-999',
      });
      expect(result.taxonomy).toHaveLength(FACET_PAGE_SIZE + 1);
      expect(result.taxonomy.map((n) => n.code)).toContain('ZZ');
    });

    it('pins every composite page to the shard copies its unfiltered listing uses', async () => {
      const fullPage = Array.from(
        { length: FACET_PAGE_SIZE },
        (_, i) => [`AA-${i}`, 1] as [string, number],
      );
      search
        .mockResolvedValueOnce({
          aggregations: {
            contributors: composite([[WRITER_A, 1001]]),
            statuses: composite([]),
            taxonomyPath: composite(fullPage, 'AA-999'),
            taxonomyCodes: composite([]),
          },
        })
        .mockResolvedValueOnce({
          aggregations: { taxonomyPath: composite([['ZZ', 1001]]) },
        });
      await service.facets({ resourceWriterIds: [WRITER_A] });
      const facetPreferences = search.mock.calls.map(([b]) => b.preference);

      search.mockResolvedValue(emptyPage);
      await service.search({ resourceWriterIds: [WRITER_A] });
      const listing = lastRequest().preference;

      expect(facetPreferences).toEqual([listing, listing]);
      expect(listing).toEqual(expect.any(String));

      search.mockResolvedValue({ aggregations: {} });
      await service.facets({ resourceWriterIds: [WRITER_B] });
      expect(lastRequest().preference).not.toBe(listing);
    });
  });

  describe('geography and virtual (ISS-1873, ISS-1874, ISS-1895)', () => {
    it('ORs Regions by intersecting service_area with the indexed Region shape, plus Virtual Services with no Service Area', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { geography: { regionIds: ['county:29510', 'zip:63110'] } },
      });
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
        servesClause('county:29510', 'zip:63110'),
      ]);
    });

    it('never treats a missing Service Area as global when virtual is excluded', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: {
          geography: { regionIds: ['state:MO'] },
          virtual: 'exclude',
        },
      });
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
        regionClause('state:MO'),
        { term: { locationTypes: 'physical' } },
      ]);
    });

    it('counts facets under the same geography clause as the list', async () => {
      search.mockResolvedValue({ aggregations: {} });
      await service.facets({
        resourceWriterIds: [WRITER_A],
        filter: { geography: { regionIds: ['state:MO'] }, virtual: 'only' },
      });
      expect(JSON.stringify(lastRequest().query)).toContain(
        JSON.stringify(servesClause('state:MO')),
      );
    });

    it('ANDs geography with taxonomy, status, virtual and text', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: {
          taxonomyCodes: ['BD'],
          statuses: ['active'],
          geography: { regionIds: ['state:MO'] },
          virtual: 'only',
        },
        text: 'food',
      });
      const { bool } = lastRequest().query;
      expect(bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
        { terms: { taxonomyPath: ['BD'] } },
        { terms: { status: ['active'] } },
        servesClause('state:MO'),
        { term: { locationTypes: 'virtual' } },
      ]);
      expect(bool.must).toHaveLength(1);
      expect(bool.should).toBeUndefined();
    });

    it('drops a repeated Region id', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { geography: { regionIds: ['state:MO', 'state:MO'] } },
      });
      expect(lastRequest().query.bool.filter[2]).toEqual(
        servesClause('state:MO'),
      );
    });

    it.each([
      ['only', { term: { locationTypes: 'virtual' } }],
      ['exclude', { term: { locationTypes: 'physical' } }],
    ] as const)('virtual %s filters on locationTypes', async (mode, clause) => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { virtual: mode },
      });
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
        clause,
      ]);
    });

    it('virtual all adds no clause', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { virtual: 'all' },
      });
      expect(lastRequest().query.bool.filter).toHaveLength(2);
    });

    it('checks the Regions exist with one mget, and skips it without geography', async () => {
      await service.search({
        resourceWriterIds: [WRITER_A],
        filter: { geography: { regionIds: ['state:MO', 'zip:63110'] } },
      });
      expect(mget).toHaveBeenCalledTimes(1);
      expect(mget).toHaveBeenCalledWith({
        index: 'regions',
        ids: ['state:MO', 'zip:63110'],
        _source: false,
      });

      mget.mockClear();
      await service.search({ resourceWriterIds: [WRITER_A] });
      await service.facets({ resourceWriterIds: [WRITER_A] });
      expect(mget).not.toHaveBeenCalled();
    });

    it('answers unknown Region ids with 400 naming them, without searching', async () => {
      mget.mockResolvedValueOnce({
        docs: [
          { _index: 'regions', _id: 'zip:00000', found: false },
          { _index: 'regions_v1', _id: 'state:MO', found: true },
          { _index: 'regions', _id: 'county:99999', found: false },
        ],
      });
      const failure = service.search({
        resourceWriterIds: [WRITER_A],
        filter: {
          geography: { regionIds: ['zip:00000', 'state:MO', 'county:99999'] },
        },
      });
      await expect(failure).rejects.toBeInstanceOf(BadRequestException);
      await expect(failure).rejects.toThrow(
        'Unknown Region id(s): zip:00000, county:99999',
      );
      expect(search).not.toHaveBeenCalled();
    });

    it('answers unknown Region ids on facets with 400, without aggregating', async () => {
      mget.mockResolvedValueOnce({
        docs: [{ _index: 'regions', _id: 'zip:00000', found: false }],
      });
      await expect(
        service.facets({
          resourceWriterIds: [WRITER_A],
          filter: { geography: { regionIds: ['zip:00000'] } },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(search).not.toHaveBeenCalled();
    });

    it("maps ES's missing-shape 400 to 400, not 502", async () => {
      search.mockRejectedValueOnce(missingShapeError('county:29510'));
      const failure = service.search({
        resourceWriterIds: [WRITER_A],
        filter: { geography: { regionIds: ['county:29510'] } },
      });
      await expect(failure).rejects.toBeInstanceOf(BadRequestException);
      await expect(failure).rejects.toThrow('county:29510');

      search.mockRejectedValueOnce(missingShapeError('state:MO'));
      await expect(
        service.facets({
          resourceWriterIds: [WRITER_A],
          filter: { geography: { regionIds: ['state:MO'] } },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still maps any other ES 400 to 502', async () => {
      search.mockRejectedValueOnce(
        new errors.ResponseError({
          statusCode: 400,
          body: { error: { type: 'parsing_exception', reason: 'bad' } },
          headers: {},
          warnings: null,
          meta: {} as never,
        }),
      );
      await expect(
        service.search({ resourceWriterIds: [WRITER_A] }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('narrows facets by geography and virtual, so counts match the list', async () => {
      search.mockResolvedValue({ aggregations: {} });
      await service.facets({
        resourceWriterIds: [WRITER_A],
        filter: {
          geography: { regionIds: ['county:29189'] },
          virtual: 'exclude',
        },
      });
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { resourceWriterId: [WRITER_A] } },
        { exists: { field: 'serviceId' } },
        regionClause('county:29189'),
        { term: { locationTypes: 'physical' } },
      ]);
    });

    describe('cursor fingerprint', () => {
      const issueWith = async (filter: object) => {
        search.mockResolvedValueOnce({
          hits: {
            total: { value: 2 },
            hits: [
              { _id: 't:s1', _source: { serviceId: 's1' }, sort: ['A', 's1'] },
              { _id: 't:s2', _source: { serviceId: 's2' }, sort: ['B', 's2'] },
            ],
          },
        });
        const page = await service.search({
          resourceWriterIds: [WRITER_A],
          limit: 1,
          filter,
        });
        search.mockClear();
        return page.nextCursor!;
      };
      const geo = (...regionIds: string[]) => ({ geography: { regionIds } });

      it.each([
        ['another Region', geo('state:MO'), geo('state:KS')],
        ['no geography', geo('state:MO'), {}],
        ['added geography', {}, geo('state:MO')],
        ['another virtual mode', { virtual: 'only' }, { virtual: 'exclude' }],
        ['virtual added', {}, { virtual: 'only' }],
      ])('rejects a cursor replayed with %s', async (_l, issued, replayed) => {
        const cursor = await issueWith(issued);
        await expect(
          service.search({
            resourceWriterIds: [WRITER_A],
            filter: replayed as never,
            cursor,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(search).not.toHaveBeenCalled();
      });

      it('accepts it for the same geography and virtual mode', async () => {
        const filter = { ...geo('state:MO'), virtual: 'only' as const };
        const cursor = await issueWith(filter);
        await service.search({ resourceWriterIds: [WRITER_A], filter, cursor });
        expect(lastRequest().search_after).toEqual(['A', 's1']);
      });

      it("treats virtual 'all' as no virtual clause", async () => {
        const cursor = await issueWith({});
        await service.search({
          resourceWriterIds: [WRITER_A],
          filter: { virtual: 'all' },
          cursor,
        });
        expect(lastRequest().search_after).toEqual(['A', 's1']);
      });
    });
  });
});

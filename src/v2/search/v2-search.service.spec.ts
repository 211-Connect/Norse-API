/* eslint-disable @typescript-eslint/no-require-imports */
import { errors } from '@elastic/elasticsearch';
import { trace } from '@opentelemetry/api';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchService } from 'src/search/search.service';
import { HybridSearchService } from 'src/search/hybrid-search.service';
import { SearchResponse } from 'src/search/dto/search-response.dto';
import { RULES_VERSION } from '../rules';
import {
  ClassifyResult,
  SearchClassificationClient,
} from './search-classification.client';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import {
  hasContentWord,
  V2SearchService,
  tenantHotlines,
  topTexts,
} from './v2-search.service';
import { DEFAULT_HOTLINES, DEFAULT_TOP_AREAS } from '../rules/config';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { SearchConfigCache } from 'src/cms-config/types/search-config-cache';
import { RegionService, RegionSummaryDto } from 'src/region/internal';
import { isMarkedNotStorable } from 'src/common/interceptors/cdn-cache-control.interceptor';

const golden: {
  rows: {
    query: string;
    needs: Record<string, number>;
    emergency: { score: number; floor_hit: boolean };
  }[];
} = require('../rules/__fixtures__/golden-scores.json');

const headers = {
  'x-tenant-id': '11111111-1111-4111-8111-111111111111',
  'accept-language': 'en',
} as HeadersDto;

const hybridResponse = (total: number | { value: number } = 12) =>
  ({
    search: {
      took: 1,
      timed_out: false,
      _shards: {},
      // One unrelated hit: an empty page reads as match "spread".
      hits: {
        total,
        hits: [
          { _source: { name: 'a service', organization: { name: 'An Org' } } },
        ],
      },
    },
    facets: [],
  }) as unknown as SearchResponse;

const dto = (over: Partial<V2SearchQueryDto> = {}): V2SearchQueryDto =>
  Object.assign(new V2SearchQueryDto(), { clarify: 'auto' }, over);

const okResult = (
  scores: Record<string, number>,
  over: Partial<ClassifyResult> = {},
): ClassifyResult => ({
  signals: {
    needs: { status: 'ok', scores },
    emergency: { status: 'ok', score: 0.001, floor_hit: false },
  },
  scores,
  modelVersion: 'mv-1',
  ...over,
});

const errorResult = (): ClassifyResult => ({
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
});

function build(opts: {
  classify?: jest.Mock;
  search?: jest.Mock;
  startEarlyRetrieval?: jest.Mock;
  searchConfig?: SearchConfigCache;
  getSummaries?: jest.Mock;
  searchPins?: jest.Mock;
  /** V2_QUESTION_RULE_V1. Default 'true': the suites below test question rule v1. Any other value (or 'off') runs development's engine. */
  ruleV1?: string;
}) {
  const classify = opts.classify ?? jest.fn().mockResolvedValue(okResult({}));
  const searchHybrid =
    opts.search ?? jest.fn().mockResolvedValue(hybridResponse());
  const startEarlyRetrieval =
    opts.startEarlyRetrieval ?? jest.fn().mockReturnValue({ stage: undefined });
  const getSearchConfig = jest.fn().mockResolvedValue(opts.searchConfig ?? {});
  const getSummaries = opts.getSummaries ?? jest.fn().mockResolvedValue([]);
  const searchPins =
    opts.searchPins ??
    jest.fn().mockResolvedValue({ total: 0, truncated: false, pins: [] });
  const service = new V2SearchService(
    { classify } as unknown as SearchClassificationClient,
    {
      searchHybrid,
      startEarlyRetrieval,
    } as unknown as HybridSearchService,
    { getSearchConfig } as unknown as TenantConfigService,
    { getSummaries } as unknown as RegionService,
    { searchPins } as unknown as SearchService,
    {
      get: (k: string) =>
        k === 'V2_QUESTION_RULE_V1' ? (opts.ruleV1 ?? 'true') : undefined,
    } as unknown as ConfigService,
  );
  return {
    searchPins,
    service,
    classify,
    searchHybrid,
    startEarlyRetrieval,
    getSearchConfig,
    getSummaries,
  };
}

describe('V2SearchService', () => {
  describe('filters, facets and counts (ISS-2499)', () => {
    it('passes filters, organization_id, age, geo_type, taxonomy, distance, sort, page and limit to searchHybrid unchanged', async () => {
      const { service, searchHybrid } = build({});
      const query = dto({
        query: 'food',
        filters: { languages: 'Spanish', age_group: ['a', 'b'] },
        organization_id: 'org-1',
        age: 30,
        geo_type: 'proximity',
        taxonomy: ['BH-1800'],
        distance: 10,
        sort: 'name',
        page: 2,
        limit: 50,
      });
      await service.search({ headers, query });
      const arg = searchHybrid.mock.calls[0][0];
      expect(arg.query).toMatchObject({
        filters: { languages: 'Spanish', age_group: ['a', 'b'] },
        organization_id: 'org-1',
        age: 30,
        geo_type: 'proximity',
        taxonomy: ['BH-1800'],
        distance: 10,
        sort: 'name',
        page: 2,
        limit: 50,
        query_type: 'hybrid',
      });
      expect(arg.rankingVersion).toBe('v2');
      expect(arg.query).not.toHaveProperty('needs');
      expect(arg.query).not.toHaveProperty('classify');
    });

    it('returns the facets from searchHybrid in the v2 response', async () => {
      const facets = [
        {
          key: 'languages',
          name: { en: 'Languages', locale: 'Languages' },
          values: [{ en: 'Spanish', locale: 'Spanish', doc_count: 7 }],
        },
      ];
      const { service } = build({
        search: jest.fn().mockResolvedValue({ ...hybridResponse(7), facets }),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'food', filters: { languages: 'Spanish' } }),
      });
      expect(res.facets).toEqual(facets);
    });

    it('sends needs to searchHybrid as selectedNeeds and countCodes together with the filters; needCounts do not leak into the response', async () => {
      const { service, searchHybrid } = build({
        search: jest.fn().mockResolvedValue({
          ...hybridResponse(7),
          needCounts: { 'N-FOD': 5 },
        }),
      });
      const res = await service.search({
        headers,
        query: dto({
          query: 'food',
          needs: ['N-FOD'],
          filters: { languages: 'Spanish' },
        }),
      });
      const arg = searchHybrid.mock.calls[0][0];
      expect(arg.selectedNeeds).toEqual(['N-FOD']);
      expect(arg.query.filters).toEqual({ languages: 'Spanish' });
      expect(res).not.toHaveProperty('needCounts');
    });

    it('clarify=never sends no countCodes, filters still pass', async () => {
      const { service, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({
          query: 'food',
          clarify: 'never',
          filters: { languages: 'Spanish' },
        }),
      });
      const arg = searchHybrid.mock.calls[0][0];
      expect(arg).not.toHaveProperty('countCodes');
      expect(arg.query.filters).toEqual({ languages: 'Spanish' });
    });
  });

  it('starts the classify-independent retrieval before classify resolves', async () => {
    let resolveClassify!: (r: ClassifyResult) => void;
    const classify = jest.fn().mockReturnValue(
      new Promise<ClassifyResult>((r) => {
        resolveClassify = r;
      }),
    );
    const { service, startEarlyRetrieval, searchHybrid } = build({ classify });
    const pending = service.search({
      headers,
      query: dto({ query: 'food shelf', needs: ['N-01', 'N-X'] }),
    });
    // Classify starts after the tenant config read; a macrotask later every
    // microtask before it has run, however many spans wrap the steps.
    await new Promise((r) => setImmediate(r));
    expect(classify).toHaveBeenCalledTimes(1);
    expect(startEarlyRetrieval).toHaveBeenCalledTimes(1);
    expect(searchHybrid).not.toHaveBeenCalled();
    const early = startEarlyRetrieval.mock.calls[0][0];
    expect(early.query).toMatchObject({
      query: 'food shelf',
      query_type: 'hybrid',
    });
    expect(early.rankingVersion).toBe('v2');
    expect(early.selectedNeeds).toEqual(['N-01']);
    expect(early).not.toHaveProperty('needScores');
    expect(early).not.toHaveProperty('countCodes');
    resolveClassify(okResult({}));
    await pending;
  });

  it('passes the early handle and the same inputs to searchHybrid', async () => {
    const handle = { stage: Promise.resolve() };
    const { service, startEarlyRetrieval, searchHybrid } = build({
      startEarlyRetrieval: jest.fn().mockReturnValue(handle),
    });
    await service.search({ headers, query: dto({ query: 'rent help' }) });
    const started = startEarlyRetrieval.mock.calls[0][0];
    const final = searchHybrid.mock.calls[0][0];
    expect(final.early).toBe(handle);
    expect(final.headers).toBe(started.headers);
    expect(final.query).toBe(started.query);
    expect(final.body).toBe(started.body);
    expect(final.rankingVersion).toBe(started.rankingVersion);
  });

  describe('relevance_cutoff (off by default)', () => {
    const cutoffOf = async (query: Partial<V2SearchQueryDto>) => {
      const { service, searchHybrid } = build({});
      await service.search({ headers, query: dto(query) });
      return searchHybrid.mock.calls[0][0].query.relevance_cutoff;
    };
    it('text: the default off reaches the search', async () => {
      expect(await cutoffOf({ query: 'rent help' })).toBe('off');
    });
    it('text: caller on reaches the search', async () => {
      expect(
        await cutoffOf({ query: 'rent help', relevance_cutoff: 'on' }),
      ).toBe('on');
    });
    it('empty query (browse): off', async () => {
      expect(await cutoffOf({ query: '' })).toBe('off');
      expect(await cutoffOf({ query: '   ' })).toBe('off');
    });
  });

  it.each(['distance', 'name', 'organization'] as const)(
    'sends sort=%s and coords to the hybrid query',
    async (sort) => {
      const { service, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({ query: 'rent help', sort, coords: [-122.3, 47.6] }),
      });
      const q = searchHybrid.mock.calls[0][0].query;
      expect(q.sort).toBe(sort);
      expect(q.coords).toEqual([-122.3, 47.6]);
    },
  );

  // David 2026-11-18: sort is required at the API level. v2 passes the v1
  // sort parameter to the hybrid query unchanged.
  it.each(['relevance', 'distance', 'name', 'organization'] as const)(
    'passes sort=%s to searchHybrid',
    async (sort) => {
      const { service, searchHybrid } = build({});
      await service.search({ headers, query: dto({ query: 'food', sort }) });
      expect(searchHybrid.mock.calls[0][0].query.sort).toBe(sort);
    },
  );

  it('starts no early retrieval when there is no text', async () => {
    const { service, startEarlyRetrieval, searchHybrid } = build({});
    await service.search({ headers, query: dto({ query: '' }) });
    expect(startEarlyRetrieval).not.toHaveBeenCalled();
    expect(searchHybrid.mock.calls[0][0]).not.toHaveProperty('early');
  });

  // Break run 2026-11-14: accept-language xx-YY was a 500, because the index
  // hybrid_search_resources_xx does not exist.
  it('turns a missing language index into a 400 that names the language', async () => {
    const notFound = Object.assign(new Error('index_not_found_exception'), {
      meta: {
        statusCode: 404,
        body: { error: { type: 'index_not_found_exception' } },
      },
    });
    const { service } = build({
      search: jest.fn().mockRejectedValue(notFound),
    });
    const err = await service
      .search({
        headers: { ...headers, 'accept-language': 'xx-YY' } as HeadersDto,
        query: dto({ query: 'food' }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(JSON.stringify(err.getResponse())).toContain(
      'no search index for accept-language xx-YY',
    );
  });

  // Break run 2026-11-14: 500 emoji (1000 UTF-16 units, under the cap) made
  // Elasticsearch fail with "input automaton is too large", a 500.
  it.each([
    'failed to create query: input automaton is too large: 1001',
    'failed to create query: The length of prefix [1200] used in the Prefix Query request has exceeded the allowed maximum of [1000].',
  ])('turns a query-too-large search error into a 400 (%s)', async (reason) => {
    const tooLarge = Object.assign(
      new Error('search_phase_execution_exception'),
      {
        meta: {
          statusCode: 400,
          body: {
            error: {
              type: 'search_phase_execution_exception',
              root_cause: [{ type: 'query_shard_exception', reason }],
            },
          },
        },
      },
    );
    const { service } = build({
      search: jest.fn().mockRejectedValue(tooLarge),
    });
    const err = await service
      .search({ headers, query: dto({ query: '😀'.repeat(500) }) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain(
      'query is too long for search',
    );
  });

  // The real client error: a ResponseError built from the HTTP body, as
  // @elastic/transport reports it (meta.body.error.type / root_cause).
  const responseError = (statusCode: number, error: Record<string, unknown>) =>
    new errors.ResponseError({
      body: { error, status: statusCode },
      statusCode,
      headers: {},
      warnings: null,
      meta: {} as any,
    });

  it('turns a real ResponseError index_not_found_exception into a 400', async () => {
    const real = responseError(404, {
      root_cause: [
        {
          type: 'index_not_found_exception',
          reason: 'no such index [hybrid_search_resources_xx]',
          'resource.type': 'index_or_alias',
          'resource.id': 'hybrid_search_resources_xx',
          index: 'hybrid_search_resources_xx',
        },
      ],
      type: 'index_not_found_exception',
      reason: 'no such index [hybrid_search_resources_xx]',
    });
    const { service } = build({ search: jest.fn().mockRejectedValue(real) });
    const err = await service
      .search({ headers, query: dto({ query: 'food' }) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain('no search index');
  });

  it.each([
    [
      'automaton, by type',
      {
        type: 'search_phase_execution_exception',
        reason: 'all shards failed',
        root_cause: [
          {
            type: 'too_complex_to_determinize_exception',
            reason:
              'Determinizing automaton would require more than 10000 work',
          },
        ],
      },
    ],
    [
      'automaton, by text',
      {
        type: 'search_phase_execution_exception',
        reason: 'all shards failed',
        root_cause: [
          {
            type: 'query_shard_exception',
            reason:
              'failed to create query: input automaton is too large: 1001',
          },
        ],
      },
    ],
    [
      'prefix length, by text',
      {
        type: 'search_phase_execution_exception',
        reason: 'all shards failed',
        root_cause: [
          {
            type: 'query_shard_exception',
            reason:
              'failed to create query: The length of prefix [1200] used in the Prefix Query request has exceeded the allowed maximum of [1000].',
          },
        ],
      },
    ],
  ])('turns a real ResponseError (%s) into a 400', async (_label, error) => {
    const real = responseError(400, error);
    const { service } = build({ search: jest.fn().mockRejectedValue(real) });
    const err = await service
      .search({ headers, query: dto({ query: 'food' }) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain(
      'query is too long for search',
    );
  });

  it('does not treat an unrelated real ResponseError as too large', async () => {
    const real = responseError(400, {
      type: 'search_phase_execution_exception',
      reason: 'all shards failed',
      root_cause: [{ type: 'parse_exception', reason: 'bad' }],
    });
    const { service } = build({ search: jest.fn().mockRejectedValue(real) });
    await expect(
      service.search({ headers, query: dto({ query: 'food' }) }),
    ).rejects.toBe(real);
  });

  it('rethrows other search errors unchanged', async () => {
    const boom = new Error('boom');
    const { service } = build({ search: jest.fn().mockRejectedValue(boom) });
    await expect(
      service.search({ headers, query: dto({ query: 'food' }) }),
    ).rejects.toBe(boom);
  });

  it('skips classify when there is no text and still searches', async () => {
    const { service, classify, searchHybrid } = build({});
    const res = await service.search({ headers, query: dto({ query: '   ' }) });
    expect(classify).not.toHaveBeenCalled();
    expect(searchHybrid).toHaveBeenCalledTimes(1);
    expect(res.model_version).toBeNull();
    expect(res.intent.query).toBeNull();
    expect(res.rules_version).toBe(RULES_VERSION);
    expect(res).not.toHaveProperty('emergency');
  });

  it('sends one normalized text form to the models and keeps the typed text elsewhere', async () => {
    const { service, classify, startEarlyRetrieval, searchHybrid } = build({});
    const res = await service.search({
      headers,
      query: dto({ query: 'FOOD PANTRY?' }),
    });
    // The early stage embeds options.query.query.
    expect(startEarlyRetrieval.mock.calls[0][0].query.query).toBe(
      'food pantry',
    );
    expect(classify.mock.calls[0][0]).toBe('food pantry');
    expect(searchHybrid.mock.calls[0][0].query.query).toBe('food pantry');
    expect(res.intent.query).toBe('FOOD PANTRY?');
  });

  it('sends exactly 512 characters to classify for a 600-character query and searches with the full query', async () => {
    const { service, classify, searchHybrid } = build({});
    const long = 'a'.repeat(600);
    await service.search({ headers, query: dto({ query: long }) });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][0]).toHaveLength(512);
    expect(classify.mock.calls[0][0]).toBe(long.slice(0, 512));
    expect(searchHybrid.mock.calls[0][0].query.query).toBe(long);
  });

  // A cut inside a surrogate pair would send ml-broker half an emoji, which
  // can fail the call and lose the emergency band (David, PR #279 review).
  describe('the 512 cut never splits a character', () => {
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const sent = async (query: string) => {
      const { service, classify } = build({});
      await service.search({ headers, query: dto({ query }) });
      return classify.mock.calls[0][0] as string;
    };

    it('drops a pair that would straddle the cut', async () => {
      const text = await sent('a'.repeat(511) + '😀' + 'tail');
      expect(text).toBe('a'.repeat(511));
      expect(text).not.toMatch(loneSurrogate);
    });

    it('keeps a pair that ends exactly at the cut', async () => {
      const text = await sent('a'.repeat(510) + '😀' + 'tail');
      expect(text).toBe('a'.repeat(510) + '😀');
      expect(text).toHaveLength(512);
    });

    it('never sends a lone surrogate for an all-emoji query', async () => {
      expect(await sent('😀'.repeat(300))).not.toMatch(loneSurrogate);
    });
  });

  it('leaves a 512-character query unchanged', async () => {
    const { service, classify } = build({});
    const text = 'b'.repeat(512);
    await service.search({ headers, query: dto({ query: text }) });
    expect(classify.mock.calls[0][0]).toBe(text);
  });

  it('does not classify a whitespace-only query', async () => {
    const { service, classify } = build({});
    await service.search({ headers, query: dto({ query: '   \n\t ' }) });
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies a string query with the tenant id and reports the model version', async () => {
    const { service, classify } = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-HOU-02': 0.99 })),
    });
    const res = await service.search({
      headers,
      query: dto({ query: ' rent help ' }),
    });
    expect(classify).toHaveBeenCalledWith(
      'rent help',
      headers['x-tenant-id'],
      'on',
    );
    expect(res.model_version).toBe('mv-1');
    expect(res.intent.query).toBe(' rent help ');
  });

  it('returns results with model_version null when classify fails', async () => {
    const { service, searchHybrid } = build({
      classify: jest.fn().mockResolvedValue(errorResult()),
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'rent' }),
    });
    expect(res.search.hits.total).toEqual(12);
    expect(res.model_version).toBeNull();
    // Band unknown has no field (Decision 54): no emergency question, no block.
    expect(res).not.toHaveProperty('emergency');
    expect(
      res.clarification.questions.find((q) => q.id === 'emergency'),
    ).toBeUndefined();
    expect(searchHybrid).toHaveBeenCalledTimes(1);
  });

  it('maps boostNeeds to NeedScore with tier and classify score', async () => {
    const { service, searchHybrid } = build({
      classify: jest
        .fn()
        .mockResolvedValue(okResult({ 'N-HOU-02': 0.99, 'N-HOU': 0.95 })),
    });
    await service.search({ headers, query: dto({ query: 'rent' }) });
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.needScores).toEqual([
      { code: 'N-HOU-02', tier: 'tier2', score: 0.99 },
    ]);
  });

  it('gives a caller need score 1 and its tier, and skips N-X', async () => {
    const { service, searchHybrid } = build({});
    await service.search({
      headers,
      query: dto({ query: '', needs: ['N-HOU', 'N-FOD-01', 'N-X'] }),
    });
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.needScores).toEqual(
      expect.arrayContaining([
        { code: 'N-HOU', tier: 'tier1', score: 1 },
        { code: 'N-FOD-01', tier: 'tier2', score: 1 },
      ]),
    );
    expect(arg.needScores.map((n: { code: string }) => n.code)).not.toContain(
      'N-X',
    );
  });

  it('runs hybrid ranking v2 and keeps v2-only fields out of the v1 query', async () => {
    const { service, searchHybrid } = build({});
    await service.search({
      headers,
      query: dto({
        query: 'rent',
        needs: ['N-HOU'],
        passed_needs: ['N-FOD'],
        urgency: 'U-2',
        clarify: 'never',
        page: 2,
        limit: 50,
      }),
    });
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.rankingVersion).toBe('v2');
    expect(arg.headers).toBe(headers);
    expect(arg.query.query_type).toBe('hybrid');
    expect(arg.query.page).toBe(2);
    expect(arg.query.limit).toBe(50);
    for (const key of ['needs', 'passed_needs', 'urgency', 'clarify']) {
      expect(arg.query).not.toHaveProperty(key);
    }
  });

  it('passes a body through to searchHybrid', async () => {
    const { service, searchHybrid } = build({});
    const body = { geometry: { type: 'Point', coordinates: [1, 2] } };
    await service.search({
      headers,
      query: dto({ query: 'rent' }),
      body: body as never,
    });
    expect(searchHybrid.mock.calls[0][0].body).toBe(body);
  });

  it('leaves body absent when none is given', async () => {
    const { service, searchHybrid } = build({});
    await service.search({ headers, query: dto({ query: 'rent' }) });
    expect(searchHybrid.mock.calls[0][0].body).toBeUndefined();
  });

  it('builds intent from the decision: caller and inferred needs, urgency', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-HOU-02': 0.99 })),
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'rent', needs: ['N-FOD-01'], urgency: 'U-3' }),
    });
    expect(res.intent.needs).toEqual(
      expect.arrayContaining([
        {
          value: 'N-FOD-01',
          source: 'caller',
          state: 'use',
          description: expect.stringMatching(/\S/),
        },
        expect.objectContaining({
          value: 'N-HOU-02',
          source: 'inferred',
          state: 'use',
          confidence: 0.99,
          description: expect.stringMatching(/\S/),
        }),
      ]),
    );
    expect(res.intent.urgency).toEqual({
      value: 'U-3',
      source: 'caller',
      state: expect.any(String),
    });
  });

  it('reads the hits total as a number or as { value }', async () => {
    // total 0 drops every needs question, so only the total changes the output.
    const scores = { 'N-HOU-02': 0.5, 'N-HOU-03': 0.4 };
    const asNumber = build({
      classify: jest.fn().mockResolvedValue(okResult(scores)),
      search: jest.fn().mockResolvedValue(hybridResponse(0)),
    });
    const asObject = build({
      classify: jest.fn().mockResolvedValue(okResult(scores)),
      search: jest.fn().mockResolvedValue(hybridResponse({ value: 0 })),
    });
    const a = await asNumber.service.search({
      headers,
      query: dto({ query: 'x' }),
    });
    const b = await asObject.service.search({
      headers,
      query: dto({ query: 'x' }),
    });
    expect(a.clarification).toEqual(b.clarification);
    expect(a.clarification.questions.filter((q) => q.type === 'need')).toEqual(
      [],
    );
  });

  it('an unreadable hits.total is not counted (totalCounted false from the hybrid service), keeps needs questions and leaks no totalCounted', async () => {
    const scores = { 'N-HOU-02': 0.5, 'N-HOU-03': 0.4 };
    {
      const unreadable = build({
        classify: jest.fn().mockResolvedValue(okResult(scores)),
        search: jest.fn().mockResolvedValue({
          ...hybridResponse(0),
          totalCounted: false,
        } as never),
      });
      const zero = build({
        classify: jest.fn().mockResolvedValue(okResult(scores)),
        search: jest.fn().mockResolvedValue(hybridResponse(0)),
      });
      const a = await unreadable.service.search({
        headers,
        query: dto({ query: 'x' }),
      });
      const b = await zero.service.search({
        headers,
        query: dto({ query: 'x' }),
      });
      const needsQ = (r: typeof a) =>
        r.clarification.questions.filter((q) => q.type === 'need');
      expect(needsQ(b)).toEqual([]);
      expect(needsQ(a).length).toBeGreaterThan(0);
      expect('totalCounted' in a).toBe(false);
    }
  });

  it('feeds a golden row through the service: at most 3 questions, snake_case keys', async () => {
    let sawQuestionWithOptions = false;
    for (const r of golden.rows) {
      const { service: s } = build({
        classify: jest.fn().mockResolvedValue(
          okResult(r.needs, {
            signals: {
              needs: { status: 'ok', scores: r.needs },
              emergency: {
                status: 'ok',
                score: r.emergency.score,
                floor_hit: r.emergency.floor_hit,
              },
            },
          }),
        ),
      });
      const res = await s.search({ headers, query: dto({ query: r.query }) });
      expect(res.clarification.rules_version).toBe(RULES_VERSION);
      expect(res.clarification.questions.length).toBeLessThanOrEqual(3);
      const json = JSON.stringify(res.clarification.questions);
      expect(json).not.toMatch(
        /"(multiSelect|allowOther|noneOfThese|resultsCount)"/,
      );
      for (const q of res.clarification.questions) {
        expect(q).toHaveProperty('multi_select');
        expect(q).toHaveProperty('allow_other');
        expect(q).toHaveProperty('none_of_these');
        if (q.options.length > 0) sawQuestionWithOptions = true;
      }
    }
    expect(sawQuestionWithOptions).toBe(true);
  });

  describe('need blocks and counts (ISS-2499)', () => {
    it('sends caller needs as selectedNeeds, without N-X', async () => {
      const { service, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({ needs: ['N-FOD-01', 'N-X', 'N-HOU'] }),
      });
      expect(searchHybrid.mock.calls[0][0].selectedNeeds).toEqual([
        'N-FOD-01',
        'N-HOU',
      ]);
    });

    it('sends no selectedNeeds when N-X is the only need', async () => {
      const { service, searchHybrid } = build({});
      await service.search({ headers, query: dto({ needs: ['N-X'] }) });
      expect(searchHybrid.mock.calls[0][0].selectedNeeds).toBeUndefined();
    });

    it('a model guess never makes a block, at any confidence', async () => {
      const { service, searchHybrid } = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD-01': 0.999 })),
      });
      await service.search({ headers, query: dto({ query: 'food' }) });
      expect(searchHybrid.mock.calls[0][0].selectedNeeds).toBeUndefined();
    });

    it('passed_needs never make a block', async () => {
      const { service, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({ passed_needs: ['N-FOD'] }),
      });
      expect(searchHybrid.mock.calls[0][0].selectedNeeds).toBeUndefined();
    });

    it('asks for the rules engine count_codes and passes the counts through', async () => {
      const search = jest.fn().mockResolvedValue({
        ...hybridResponse(),
        needCounts: { 'N-FOD': 3 },
      });
      const { service } = build({
        classify: jest
          .fn()
          .mockResolvedValue(okResult({ 'N-FOD-01': 0.9, 'N-HOU-01': 0.8 })),
        search,
      });
      const res: any = await service.search({
        headers,
        query: dto({ query: 'food' }),
      });
      const arg = search.mock.calls[0][0];
      expect(Array.isArray(arg.countCodes)).toBe(true);
      expect(arg.countCodes).not.toContain('N-X');
      expect('needCounts' in res).toBe(false); // internal field is not in the response
    });

    it('clarify=never does not count', async () => {
      const { service, searchHybrid } = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD-01': 0.9 })),
      });
      await service.search({
        headers,
        query: dto({ query: 'food', clarify: 'never' }),
      });
      expect(searchHybrid.mock.calls[0][0].countCodes).toBeUndefined();
    });

    it('not counted (no needCounts) keeps by_code null: every option stays', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD-01': 0.9 })),
      });
      const res: any = await service.search({
        headers,
        query: dto({ query: 'food' }),
      });
      // no needCounts from the search: options keep, none drops to 0
      expect(res.clarification).toBeDefined();
    });

    it('counted: a requested code with no count is written as 0 and its option stays with 0', async () => {
      const search = jest.fn().mockImplementation(async (a: any) => ({
        ...hybridResponse(10),
        needCounts: Object.fromEntries(
          (a.countCodes as string[]).map((c) => [c, 0]),
        ),
      }));
      const { service } = build({
        classify: jest
          .fn()
          .mockResolvedValue(okResult({ 'N-FOD': 0.9, 'N-FOD-01': 0.5 })),
        search,
      });
      const res: any = await service.search({
        headers,
        query: dto({ query: 'food' }),
      });
      const needQs = res.clarification.questions.filter(
        (q: any) => q.type === 'need',
      );
      // Tier 1 at 0.9 makes the area clear; the hits hold no query word, so a
      // Tier 2 at 0.5 settles no kind (D1, rule R3): the area question stays,
      // each option with its count of 0.
      expect(needQs.map((q: any) => q.id)).toEqual(['area:N-FOD']);
      expect(needQs[0].options.every((o: any) => o.results_count === 0)).toBe(
        true,
      );
    });
  });

  describe('emergency in the response (ADR 0039 Decisions 50, 51, 54, 55)', () => {
    const withEmergency = (score: number) =>
      okResult(
        {},
        {
          signals: {
            needs: { status: 'ok', scores: {} },
            emergency: { status: 'ok', score, floor_hit: false },
          },
        },
      );
    const emergencyQ = (res: { clarification: { questions: any[] } }) =>
      res.clarification.questions.find((q) => q.id === 'emergency');

    // Decision 28: only band none with no emergency question may be stored by a
    // shared cache. The mark is invisible to the JSON body (Decision 59).
    describe('shared-cache rule (Decision 28)', () => {
      const run = async (classify: jest.Mock, over = {}) => {
        const { service } = build({ classify });
        return service.search({
          headers,
          query: dto({ query: 'help', ...over }),
        });
      };

      it('a clean band-none answer is storable', async () => {
        const res = await run(jest.fn().mockResolvedValue(okResult({})));
        expect(isMarkedNotStorable(res)).toBe(false);
      });

      it('a popup-band answer is not storable', async () => {
        const res = await run(jest.fn().mockResolvedValue(withEmergency(0.9)));
        expect(emergencyQ(res)).toBeDefined();
        expect(isMarkedNotStorable(res)).toBe(true);
      });

      it('a soft-band answer is not storable', async () => {
        const res = await run(jest.fn().mockResolvedValue(withEmergency(0.3)));
        expect(emergencyQ(res)).toBeDefined();
        expect(isMarkedNotStorable(res)).toBe(true);
      });

      it('a failed emergency check is not storable', async () => {
        const res = await run(jest.fn().mockResolvedValue(errorResult()));
        expect(isMarkedNotStorable(res)).toBe(true);
      });

      it('a caller U-0 answer is not storable', async () => {
        const res = await run(jest.fn().mockResolvedValue(okResult({})), {
          urgency: 'U-0',
        });
        expect(emergencyQ(res)).toBeDefined();
        expect(isMarkedNotStorable(res)).toBe(true);
      });

      it('the mark adds no key to the response', async () => {
        const res = await run(jest.fn().mockResolvedValue(withEmergency(0.9)));
        expect(Object.keys(JSON.parse(JSON.stringify(res))).sort()).toEqual(
          Object.keys(res).sort(),
        );
      });
    });

    it('top-level keys hold no emergency block', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help' }),
      });
      expect(Object.keys(res).sort()).toEqual([
        'clarification',
        'facets',
        'intent',
        'model_version',
        'rules_version',
        'search',
        'weak_match',
      ]);
    });
    it('popup band -> emergency question, urgency options only', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help' }),
      });
      const q = emergencyQ(res);
      expect(q).not.toHaveProperty('parameter');
      expect(q.options).toEqual([
        {
          label: "Yes, I'm in danger right now",
          parameter: 'urgency',
          value: 'U-0',
          results_count: null,
        },
        {
          label: "No, I'm safe, but I need help today",
          parameter: 'urgency',
          value: 'U-1',
          results_count: null,
        },
        {
          label: "No, I'm safe, I need help soon (within a week)",
          parameter: 'urgency',
          value: 'U-2',
          results_count: null,
        },
      ]);
      expect(q.hotlines.map((h) => h.number)).toEqual(['988', '911']);
    });
    it('strong band critical, soft band high, otherwise the same emergency question; no question has level; options carry results_count null', async () => {
      const pop = await build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      }).service.search({ headers, query: dto({ query: 'help' }) });
      const soft = await build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.3)),
      }).service.search({ headers, query: dto({ query: 'help' }) });
      // Lucas 2026-11-13 ("bring back the popup if the model is very sure"):
      // placement tells the bands apart (strong = popup, soft = before_results).
      // Stem, options and hotlines match.
      const strip = (q: ReturnType<typeof emergencyQ>) => ({
        ...q,
        placement: undefined,
      });
      expect(strip(emergencyQ(pop))).toEqual(strip(emergencyQ(soft)));
      expect(emergencyQ(pop).placement).toBe('popup');
      expect(emergencyQ(soft).placement).toBe('before_results');
      expect(emergencyQ(pop)).not.toHaveProperty('importance');
      expect(soft.clarification.questions[0].id).toBe('emergency');
      expect(emergencyQ(pop)).not.toHaveProperty('level');
      for (const o of emergencyQ(pop).options) {
        expect(o).toHaveProperty('results_count', null);
      }
    });
    it('soft band -> emergency question, same shape as popup', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.3)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help' }),
      });
      expect(res.clarification.questions[0].id).toBe('emergency');
      expect(emergencyQ(res).placement).toBe('before_results');
    });
    it('caller U-0 with no text -> popup with hotlines, no options; results stay', async () => {
      const { service, searchHybrid } = build({});
      const res = await service.search({
        headers,
        query: dto({ urgency: 'U-0' }),
      });
      expect(searchHybrid).toHaveBeenCalledTimes(1);
      expect(res.search.hits.total).toEqual(12);
      const q = emergencyQ(res);
      expect(q.options).toEqual([]);
      expect(q.placement).toBe('popup');
      expect(q.hotlines.map((h) => h.number)).toEqual(['988', '911']);
      expect(res.clarification.questions[0].id).toBe('emergency');
    });
    it('caller U-0 + clarify=never -> the popup stays', async () => {
      const { service } = build({});
      const res = await service.search({
        headers,
        query: dto({ query: 'help', urgency: 'U-0', clarify: 'never' }),
      });
      expect(res.clarification.questions.map((q) => q.id)).toEqual([
        'emergency',
      ]);
    });
    it('urgency=U-0 (the "Yes" answer) -> hotlines, no options, results kept', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help', urgency: 'U-0' }),
      });
      expect(emergencyQ(res).options).toEqual([]);
      expect(emergencyQ(res).hotlines.map((h) => h.number)).toEqual([
        '988',
        '911',
      ]);
      expect(res.search).toBeDefined();
    });

    it('popup band + caller U-3 -> no emergency question', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help', urgency: 'U-3' }),
      });
      expect(emergencyQ(res)).toBeUndefined();
    });
    it('popup band + clarify=never -> only the emergency question', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'help', clarify: 'never' }),
      });
      expect(res.clarification.questions.map((q) => q.id)).toEqual([
        'emergency',
      ]);
    });
  });

  // ISS-2612: `taxonomy` is a hard filter (ADR 0039 Decision 5). A topic or
  // canonical page sends codes and no text: no classify call (Decision 14);
  // needs order and boost, never filter (Decision 18).
  describe('taxonomy (ISS-2612)', () => {
    it('taxonomy alone: no classify, codes reach the hybrid search as the hard scope', async () => {
      const { service, classify, searchHybrid } = build({});
      const res = await service.search({
        headers,
        query: dto({ taxonomy: ['BD-1800.2000', 'BD-1800.1500'] }),
      });
      expect(classify).not.toHaveBeenCalled();
      const call = searchHybrid.mock.calls[0][0];
      expect(call.query.taxonomy).toEqual(['BD-1800.2000', 'BD-1800.1500']);
      expect(call.query.query_type).toBe('hybrid');
      expect(call.selectedNeeds).toBeUndefined();
      expect(res.intent.query).toBeNull();
      expect(res.model_version).toBeNull();
    });

    it('taxonomy plus needs: no classify, the scope stays and the needs order and boost', async () => {
      const { service, classify, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({ taxonomy: ['BD-1800.2000'], needs: ['N-FOD-01'] }),
      });
      expect(classify).not.toHaveBeenCalled();
      const call = searchHybrid.mock.calls[0][0];
      expect(call.query.taxonomy).toEqual(['BD-1800.2000']);
      expect(call.query).not.toHaveProperty('needs');
      expect(call.selectedNeeds).toEqual(['N-FOD-01']);
      expect(call.needScores).toEqual([
        { code: 'N-FOD-01', tier: 'tier2', score: 1 },
      ]);
    });

    it('intent echoes taxonomy as sent, source caller, not expanded', async () => {
      const { service } = build({});
      const res = await service.search({
        headers,
        query: dto({ taxonomy: ['BD-1800', 'BD-1800.2000'] }),
      });
      expect(res.intent.taxonomy).toEqual([
        { value: 'BD-1800', source: 'caller' },
        { value: 'BD-1800.2000', source: 'caller' },
      ]);
    });

    it('intent has no taxonomy key when the request sent none', async () => {
      const { service } = build({});
      const res = await service.search({ headers, query: dto({}) });
      expect('taxonomy' in res.intent).toBe(false);
    });

    it('taxonomy with text: classify runs and the scope still holds', async () => {
      const { service, classify, searchHybrid } = build({});
      await service.search({
        headers,
        query: dto({ query: 'food pantry', taxonomy: ['BD-1800.2000'] }),
      });
      expect(classify).toHaveBeenCalledTimes(1);
      expect(searchHybrid.mock.calls[0][0].query.taxonomy).toEqual([
        'BD-1800.2000',
      ]);
    });
  });
});

// Lucas 2026-11-13 (question 14): AI classification off for a tenant.
// v2 reads its own field `ai_classification` of `search_config:<tenant>`;
// only exactly 'off' is off. `search_engine` is the v1 field and is ignored.
const TENANT_OFF: SearchConfigCache = { ai_classification: 'off' };
const TENANT_ON: SearchConfigCache = { ai_classification: 'on' };

describe('V2SearchService with AI classification off', () => {
  const strong = { 'N-HOU': 0.95, 'N-HOU-01': 0.99, 'N-FOD-01': 0.5 };
  const result = (emergencyScore: number) =>
    okResult(strong, {
      signals: {
        needs: { status: 'ok', scores: strong },
        urgency: { level: 'U-1', score: 0.85 },
        emergency: { status: 'ok', score: emergencyScore, floor_hit: false },
      },
    });

  it('the default is on: the model guess is used', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(result(0.001)),
    });
    const res = await service.search({ headers, query: dto({ query: 'x' }) });
    expect(res.intent.needs.some((n) => n.source === 'inferred')).toBe(true);
  });
  it('off: classify runs once, no need guess, no boost, no question', async () => {
    const { service, classify, searchHybrid } = build({
      classify: jest.fn().mockResolvedValue(result(0.001)),
      searchConfig: TENANT_OFF,
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'x' }),
    });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(res.intent.needs).toEqual([]);
    expect(res.intent.urgency).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'drop',
    });
    expect(res.clarification.questions).toEqual([]);
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.needScores).toEqual([]);
    expect(arg).not.toHaveProperty('countCodes');
    expect(res.model_version).toBe('mv-1');
  });
  it('off: the emergency question and hotlines still appear', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(result(0.9)),
      searchConfig: TENANT_OFF,
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'x' }),
    });
    expect(res.clarification.questions.map((q) => q.id)).toEqual(['emergency']);
    expect(
      res.clarification.questions[0].hotlines.map((h) => h.number),
    ).toEqual(['988', '911']);
  });
  it('off: caller needs still boost and make blocks', async () => {
    const { service, searchHybrid } = build({
      classify: jest.fn().mockResolvedValue(result(0.001)),
      searchConfig: TENANT_OFF,
    });
    await service.search({
      headers,
      query: dto({ query: 'x', needs: ['N-FOD-01'] }),
    });
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.needScores).toEqual([
      { code: 'N-FOD-01', tier: 'tier2', score: 1 },
    ]);
    expect(arg.selectedNeeds).toEqual(['N-FOD-01']);
  });

  describe('where the setting comes from (tenant setting only)', () => {
    const classifyArg = (m: jest.Mock) => m.mock.calls[0][2];
    const guessUsed = (res: { intent: { needs: { source: string }[] } }) =>
      res.intent.needs.some((n) => n.source === 'inferred');

    it('reads the setting for the request tenant through getSearchConfig', async () => {
      const { service, getSearchConfig } = build({});
      await service.search({ headers, query: dto({ query: 'x' }) });
      expect(getSearchConfig).toHaveBeenCalledWith(headers['x-tenant-id']);
    });
    it('no setting in the Redis value: AI classification stays on', async () => {
      const { service, classify } = build({
        classify: jest.fn().mockResolvedValue(result(0.001)),
        searchConfig: {},
      });
      const res = await service.search({ headers, query: dto({ query: 'x' }) });
      expect(classifyArg(classify)).toBe('on');
      expect(guessUsed(res)).toBe(true);
    });
    it('a v1 hybrid or classic tenant (search_engine) stays on in v2', async () => {
      for (const search_engine of ['hybrid', 'classic'] as const) {
        const { service, classify } = build({
          classify: jest.fn().mockResolvedValue(result(0.001)),
          searchConfig: { search_engine },
        });
        const res = await service.search({
          headers,
          query: dto({ query: 'x' }),
        });
        expect(classifyArg(classify)).toBe('on');
        expect(guessUsed(res)).toBe(true);
      }
    });
    it('only exactly off is off: null, unknown and on stay on', async () => {
      for (const ai_classification of [null, 'OFF', 'maybe', 'on']) {
        const { service, classify } = build({
          classify: jest.fn().mockResolvedValue(result(0.001)),
          searchConfig: { ai_classification } as SearchConfigCache,
        });
        await service.search({ headers, query: dto({ query: 'x' }) });
        expect(classifyArg(classify)).toBe('on');
      }
    });
    it('tenant setting ai_classification: on', async () => {
      const { service, classify } = build({
        classify: jest.fn().mockResolvedValue(result(0.001)),
        searchConfig: TENANT_ON,
      });
      await service.search({ headers, query: dto({ query: 'x' }) });
      expect(classifyArg(classify)).toBe('on');
    });
    it('tenant setting off: off, with no request parameter', async () => {
      const { service, classify } = build({
        classify: jest.fn().mockResolvedValue(result(0.001)),
        searchConfig: TENANT_OFF,
      });
      const res = await service.search({ headers, query: dto({ query: 'x' }) });
      expect(classifyArg(classify)).toBe('off');
      expect(guessUsed(res)).toBe(false);
    });
    it('a classify=off sent by a caller changes nothing: classify stays on', async () => {
      const { service, classify } = build({
        classify: jest.fn().mockResolvedValue(result(0.001)),
        searchConfig: TENANT_ON,
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'x', classify: 'off' } as never),
      });
      expect(classifyArg(classify)).toBe('on');
      expect(guessUsed(res)).toBe(true);
    });
    it('the tenant setting off still turns the need guess off, with no request parameter', async () => {
      const { service, classify } = build({
        classify: jest.fn().mockResolvedValue(result(0.001)),
        searchConfig: TENANT_OFF,
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'x', classify: 'on' } as never),
      });
      expect(classifyArg(classify)).toBe('off');
      expect(guessUsed(res)).toBe(false);
    });
  });
});

describe('hasContentWord', () => {
  it.each(['i', 'a', 'ok', 'OK', 'okay', '123', '?', '', 'I am', 'a 1', '😀'])(
    'no content word in %p',
    (q) => expect(hasContentWord(q, 'en')).toBe(false),
  );
  it.each(['help', 'kill myself', 'rent', 'comida', 'ab1', '救命'])(
    'content word in %p',
    (q) => expect(hasContentWord(q, 'en')).toBe(true),
  );
  it('uses the request language list; a language with no list counts any 2-letter token', () => {
    expect(hasContentWord('yo', 'en')).toBe(true);
    expect(hasContentWord('de la', 'es')).toBe(false);
    expect(hasContentWord('de la', 'fr')).toBe(true);
  });
});

describe('V2SearchService soft card needs a content word', () => {
  const soft = (): ClassifyResult =>
    okResult(
      {},
      {
        signals: {
          needs: { status: 'ok', scores: {} },
          emergency: { status: 'ok', score: 0.3, floor_hit: false },
        },
      },
    );
  const floor = (): ClassifyResult =>
    okResult(
      {},
      {
        signals: {
          needs: { status: 'ok', scores: {} },
          emergency: { status: 'ok', score: 0.1, floor_hit: true },
        },
      },
    );
  const hasCard = async (query: string, r: ClassifyResult) => {
    const { service } = build({ classify: jest.fn().mockResolvedValue(r) });
    const res = await service.search({ headers, query: dto({ query }) });
    return res.clarification.questions.some((q) => q.id === 'emergency');
  };
  it.each(['i', 'a', 'ok', '123', '?'])('%p: soft band, no card', async (q) => {
    expect(await hasCard(q, soft())).toBe(false);
  });
  it('help: soft band, card', async () => {
    expect(await hasCard('help', soft())).toBe(true);
  });
  it('a floor hit shows the card even without a content word', async () => {
    expect(await hasCard('i', floor())).toBe(true);
  });
});

describe('V2SearchService weak match (ISS-2796, Lucas 2026-11-18)', () => {
  const quiet = { keyword_top: 0.4, vector_top: 0.3 };
  const hit = (id: string) => ({ _id: id, _score: null, _source: {} });
  // A first-call response with hits, judges and a facet, to show what is cut.
  const firstResponse = (judges: unknown = quiet) =>
    ({
      search: {
        took: 1,
        timed_out: false,
        _shards: {},
        hits: {
          total: { value: 7, relation: 'eq' },
          max_score: null,
          hits: [hit('a'), hit('b')],
        },
      },
      facets: [{ name: 'f' }],
      relevance_cutoff: { applied: true },
      ...(judges ? { judges } : {}),
    }) as unknown as SearchResponse;
  const secondResponse = (
    total: number,
    needCounts?: Record<string, number>,
    hits: unknown[] = [],
  ) =>
    ({
      search: {
        took: 2,
        timed_out: false,
        _shards: {},
        hits: { total: { value: total, relation: 'eq' }, hits },
      },
      facets: [],
      ...(needCounts && { needCounts }),
    }) as unknown as SearchResponse;
  const weakClassify = () =>
    jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 }));
  const text = 'blorptastic zzz';
  const questionIds = (r: { clarification: { questions: { id: string }[] } }) =>
    r.clarification.questions.map((q) => q.id);

  describe('(a) weak, no needs', () => {
    it('empties the results and drops the cutoff; asks no_match; counts from a second call', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(
          secondResponse(40, { 'N-HOU': 10, 'N-FOD': 5, 'N-MON': 0 }),
        );
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text, page: 2, limit: 10 } as never),
      });
      expect(res.weak_match).toBe(true);
      expect(res.search.hits.hits).toEqual([]);
      expect(res.search.hits.total).toEqual({ value: 0, relation: 'eq' });
      expect(res.search.hits.max_score).toBeNull();
      expect(res.facets).toEqual([]);
      expect(res).not.toHaveProperty('relevance_cutoff');
      expect(res).not.toHaveProperty('judges');
      expect(res).not.toHaveProperty('needCounts');
      expect(questionIds(res)).toEqual(['no_match']);
      // N-MON has 0 services: kept, with 0. The others keep their counts.
      const q = res.clarification.questions[0];
      expect(q.options.map((o) => [o.value, o.results_count])).toEqual([
        ['N-HOU', 10],
        ['N-FOD', 5],
        ['N-MON', 0],
      ]);
      expect(search).toHaveBeenCalledTimes(2);
      const second = search.mock.calls[1][0];
      expect(second.query.query).toBe('');
      expect(second.query.relevance_cutoff).toBe('off');
      expect(second.query.limit).toBe(1);
      expect(second.query.page).toBe(1);
      expect(second).not.toHaveProperty('queryVector');
      expect(second.needScores).toEqual([]);
      expect(second.countCodes).toEqual(['N-FOD', 'N-HOU', 'N-MON']);
      expect(second).not.toHaveProperty('needFilter');
    });

    it('a used urgency boosts the first call only, never the text-free second call (ISS-2867)', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(secondResponse(40, { 'N-HOU': 10 }));
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text, urgency: 'U-1' } as never),
      });
      expect(res.weak_match).toBe(true);
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[0][0].urgencyBoost).toEqual({
        code: 'U-1',
        score: 1,
      });
      expect(search.mock.calls[1][0]).not.toHaveProperty('urgencyBoost');
    });

    it('question is dropped when every count is 0 (no sune_needs on any document)', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(secondResponse(0, {}));
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text }),
      });
      expect(res.weak_match).toBe(true);
      expect(res.clarification.questions).toEqual([]);
      expect(res.search.hits.hits).toEqual([]);
    });

    it('clarify=never: no second call, no question', async () => {
      const search = jest.fn().mockResolvedValueOnce(firstResponse());
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text, clarify: 'never' }),
      });
      expect(res.weak_match).toBe(true);
      expect(search).toHaveBeenCalledTimes(1);
      expect(res.clarification.questions).toEqual([]);
      expect(res.search.hits.hits).toEqual([]);
    });

    it('the second call keeps the filters and maps index errors to a 400', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockRejectedValueOnce(
          Object.assign(new Error('index_not_found_exception'), {
            meta: { body: { error: { type: 'index_not_found_exception' } } },
          }),
        );
      const { service } = build({ classify: weakClassify(), search });
      await expect(
        service.search({ headers, query: dto({ query: text }) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('(b) weak, caller sent needs', () => {
    it('the need-filtered second call carries no urgency boost (ISS-2867)', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(
          secondResponse(1, { 'N-FOD-01': 1 }, [hit('x')]),
        );
      const { service } = build({ classify: weakClassify(), search });
      await service.search({
        headers,
        query: dto({ query: text, needs: ['N-FOD'], urgency: 'U-1' } as never),
      });
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[0][0].urgencyBoost).toEqual({
        code: 'U-1',
        score: 1,
      });
      expect(search.mock.calls[1][0]).not.toHaveProperty('urgencyBoost');
    });
    it('second call filters by the needs with no text; its hits are the result', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(
          secondResponse(3, { 'N-FOD-01': 3 }, [hit('x'), hit('y'), hit('z')]),
        );
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text, needs: ['N-HOU', 'N-FOD'] }),
      });
      expect(search).toHaveBeenCalledTimes(2);
      const second = search.mock.calls[1][0];
      expect(second.query.query).toBe('');
      expect(second.query.relevance_cutoff).toBe('off');
      expect(second).not.toHaveProperty('queryVector');
      expect(second.needScores).toEqual([]);
      expect(second.selectedNeeds).toEqual(['N-HOU', 'N-FOD']);
      expect(second.needFilter).toEqual(['N-HOU', 'N-FOD']);
      expect(res.weak_match).toBe(true);
      expect(res.search.hits.hits.map((h) => h._id)).toEqual(['x', 'y', 'z']);
      expect(res.search.hits.total).toEqual({ value: 3, relation: 'eq' });
      expect(res).not.toHaveProperty('needCounts');
      expect(res).not.toHaveProperty('judges');
      // not the no_match question
      expect(questionIds(res)).not.toContain('no_match');
    });

    it('keeps the caller page and limit; countCodes follow the decision', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(firstResponse())
        .mockResolvedValueOnce(secondResponse(3, {}));
      const { service } = build({ classify: weakClassify(), search });
      await service.search({
        headers,
        query: dto({
          query: text,
          needs: ['N-HOU'],
          page: 2,
          limit: 5,
        } as never),
      });
      const first = search.mock.calls[0][0];
      const second = search.mock.calls[1][0];
      expect(second.query.page).toBe(first.query.page);
      expect(second.query.limit).toBe(first.query.limit);
      expect(second.countCodes).toEqual(first.countCodes);
    });
  });

  describe('(c) not weak', () => {
    it.each([
      ['keyword at 1', { keyword_top: 1, vector_top: 0 }, { 'N-FOD': 0.1 }],
      [
        'vector at 0.55',
        { keyword_top: 0, vector_top: 0.55 },
        { 'N-FOD': 0.1 },
      ],
      ['need at 0.9', quiet, { 'N-FOD': 0.9 }],
    ])(
      '%s: one call, weak_match false, results kept',
      async (_n, judges, scores) => {
        const search = jest.fn().mockResolvedValue(firstResponse(judges));
        const { service } = build({
          classify: jest.fn().mockResolvedValue(okResult(scores)),
          search,
        });
        const res = await service.search({
          headers,
          query: dto({ query: text }),
        });
        expect(search).toHaveBeenCalledTimes(1);
        expect(res.weak_match).toBe(false);
        expect(res.search.hits.hits).toHaveLength(2);
        expect(res).toHaveProperty('relevance_cutoff');
      },
    );

    it('no text: weak_match false', async () => {
      const { service } = build({});
      const res = await service.search({ headers, query: dto({ query: '' }) });
      expect(res.weak_match).toBe(false);
    });

    it('classify error: never weak', async () => {
      const search = jest.fn().mockResolvedValue(firstResponse());
      const { service } = build({
        classify: jest.fn().mockResolvedValue(errorResult()),
        search,
      });
      const res = await service.search({
        headers,
        query: dto({ query: text }),
      });
      expect(res.weak_match).toBe(false);
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('AI classification off: never weak', async () => {
      const search = jest.fn().mockResolvedValue(firstResponse());
      const { service } = build({
        classify: weakClassify(),
        search,
        searchConfig: { ai_classification: 'off' } as SearchConfigCache,
      });
      const res = await service.search({
        headers,
        query: dto({ query: text }),
      });
      expect(res.weak_match).toBe(false);
    });

    it('caller urgency U-0: never weak', async () => {
      const search = jest.fn().mockResolvedValue(firstResponse());
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text, urgency: 'U-0' }),
      });
      expect(res.weak_match).toBe(false);
    });

    it('a text with no content word is weak on the keyword judge even with a loud keyword list', async () => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(
          firstResponse({ keyword_top: 500, vector_top: 0.3 }),
        )
        .mockResolvedValueOnce(secondResponse(0, {}));
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: 'the of' }),
      });
      expect(res.weak_match).toBe(true);
    });
  });

  describe('(d) no judges', () => {
    it('the non-fused path returns no judges: not weak, one call', async () => {
      const search = jest.fn().mockResolvedValue(firstResponse(null));
      const { service } = build({ classify: weakClassify(), search });
      const res = await service.search({
        headers,
        query: dto({ query: text }),
      });
      expect(res.weak_match).toBe(false);
      expect(search).toHaveBeenCalledTimes(1);
      expect(res.search.hits.hits).toHaveLength(2);
    });
  });

  describe('(e) judges never appear in the body', () => {
    it('weak and not weak, with and without needs', async () => {
      for (const needs of [undefined, ['N-HOU']]) {
        for (const judges of [quiet, { keyword_top: 9, vector_top: 0.9 }]) {
          const search = jest
            .fn()
            .mockResolvedValueOnce(firstResponse(judges))
            .mockResolvedValue(secondResponse(1, {}));
          const { service } = build({ classify: weakClassify(), search });
          const res = await service.search({
            headers,
            query: dto({ query: text, ...(needs && { needs }) }),
          });
          expect(JSON.stringify(res)).not.toContain('judges');
          expect(JSON.stringify(res)).not.toContain('needCounts');
        }
      }
    });
  });
});

describe('V2SearchService area search (region, PR #313)', () => {
  const king = {
    id: 'county:53033',
    type: 'county',
    name: 'King County',
    state: 'WA',
  } as RegionSummaryDto;

  it('passes the area to searchHybrid and returns resolved_location', async () => {
    const getSummaries = jest.fn().mockResolvedValue([king]);
    const { service, searchHybrid } = build({
      getSummaries,
      searchConfig: { area_match: 'located' },
    });
    const result = await service.search({
      headers,
      query: dto({ query: 'food', region: ['county:53033'] }),
    });
    expect(getSummaries).toHaveBeenCalledWith(['county:53033']);
    expect(searchHybrid.mock.calls[0][0].area).toEqual({
      regionIds: ['county:53033'],
      match: 'located',
      unlocated: 'virtual',
    });
    expect(result.resolved_location).toEqual({
      regions: [king],
      area_match: 'located',
      unlocated: 'virtual',
    });
  });

  // The early stage builds its filters before the Region is resolved, so an
  // area search must not start it: its lists would ignore the area.
  it('starts no early retrieval for an area search and sends no early handle', async () => {
    const { service, searchHybrid, startEarlyRetrieval } = build({
      getSummaries: jest.fn().mockResolvedValue([king]),
    });
    await service.search({
      headers,
      query: dto({ query: 'food', region: ['county:53033'] }),
    });
    expect(startEarlyRetrieval).not.toHaveBeenCalled();
    expect(searchHybrid.mock.calls[0][0]).not.toHaveProperty('early');
  });

  it('uses the caller area_match and unlocated over the tenant defaults', async () => {
    const { service, searchHybrid } = build({
      getSummaries: jest.fn().mockResolvedValue([king]),
      searchConfig: { area_match: 'located', unlocated_in_area_search: 'all' },
    });
    const result = await service.search({
      headers,
      query: dto({
        query: 'food',
        region: ['county:53033'],
        area_match: 'serving',
        unlocated: 'none',
      }),
    });
    expect(searchHybrid.mock.calls[0][0].area).toEqual({
      regionIds: ['county:53033'],
      match: 'serving',
      unlocated: 'none',
    });
    expect(result.resolved_location).toMatchObject({
      area_match: 'serving',
      unlocated: 'none',
    });
  });

  it('rejects an unknown region with a 400 and does not search', async () => {
    const { service, searchHybrid } = build({
      getSummaries: jest
        .fn()
        .mockRejectedValue(new BadRequestException('unknown region')),
    });
    await expect(
      service.search({
        headers,
        query: dto({ query: 'food', region: ['county:99999'] }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(searchHybrid).not.toHaveBeenCalled();
  });

  it('leaves a search with no region unchanged', async () => {
    const { service, searchHybrid, getSummaries } = build({});
    const result = await service.search({
      headers,
      query: dto({ query: 'food' }),
    });
    expect(getSummaries).not.toHaveBeenCalled();
    expect(searchHybrid.mock.calls[0][0]).not.toHaveProperty('area');
    expect(result).not.toHaveProperty('resolved_location');
  });
});

describe('V2SearchService.pins', () => {
  const pinsResponse = {
    total: 1,
    truncated: false,
    pins: [
      {
        id: 'a',
        service_at_location_id: 's1',
        name: 'Food Bank',
        physical_address: null,
        coordinates: [-122, 47] as [number, number],
      },
    ],
  };

  it('asks for hybrid pins with v2 rules, the region and no v2-only fields', async () => {
    const searchPins = jest.fn().mockResolvedValue(pinsResponse);
    const { service, classify, startEarlyRetrieval } = build({ searchPins });

    const result = await service.pins({
      headers,
      query: dto({
        query: 'food',
        taxonomy: ['BH-1800'],
        region: ['county:53033'],
        area_match: 'located',
        unlocated: 'none',
        needs: ['N-HOU-02'],
        urgency: 'U-1',
        clarify: 'never',
      }),
    });

    expect(result).toBe(pinsResponse);
    const sent = searchPins.mock.calls[0][0];
    expect(sent.rankingVersion).toBe('v2');
    expect(sent.query).toMatchObject({
      query: 'food',
      query_type: 'hybrid',
      taxonomy: ['BH-1800'],
      region: ['county:53033'],
      area_match: 'located',
      unlocated: 'none',
    });
    for (const key of [
      'needs',
      'passed_needs',
      'urgency',
      'clarify',
      'classify',
    ]) {
      expect(sent.query).not.toHaveProperty(key);
    }
    // A text query classifies, so the need list matches `search` (plan rule 7).
    expect(classify).toHaveBeenCalledTimes(1);
    expect(startEarlyRetrieval).not.toHaveBeenCalled();
  });

  it('P9. pins with a failed classify: no need boost, the pins still return', async () => {
    const searchPins = jest.fn().mockResolvedValue(pinsResponse);
    const { service } = build({
      classify: jest.fn().mockResolvedValue(errorResult()),
      searchPins,
    });
    const result = await service.pins({
      headers,
      query: dto({ query: 'rent' }),
    });
    expect(result).toBe(pinsResponse);
    expect(searchPins.mock.calls[0][0].needScores ?? []).toEqual([]);
  });

  it('P10. pins with tenant ai_classification off: classify gets off, no need boost', async () => {
    const searchPins = jest.fn().mockResolvedValue(pinsResponse);
    const { service, classify } = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-HOU-02': 0.99 })),
      searchConfig: TENANT_OFF,
      searchPins,
    });
    await service.pins({ headers, query: dto({ query: 'rent' }) });
    expect(classify.mock.calls[0][2]).toBe('off');
    expect(searchPins.mock.calls[0][0].needScores ?? []).toEqual([]);
  });

  it('P8. text pins get the same needScores as search; empty text does not classify', async () => {
    const classify = jest
      .fn()
      .mockResolvedValue(okResult({ 'N-HOU-02': 0.99, 'N-HOU': 0.95 }));
    const searchPins = jest.fn().mockResolvedValue(pinsResponse);
    const { service, searchHybrid } = build({ classify, searchPins });

    await service.pins({ headers, query: dto({ query: 'rent' }) });
    await service.search({ headers, query: dto({ query: 'rent' }) });
    expect(searchPins.mock.calls[0][0].needScores).toEqual(
      searchHybrid.mock.calls[0][0].needScores,
    );
    expect(searchPins.mock.calls[0][0].needScores).toEqual([
      { code: 'N-HOU-02', tier: 'tier2', score: 0.99 },
    ]);

    classify.mockClear();
    await service.pins({ headers, query: dto({ query: '' }) });
    expect(classify).not.toHaveBeenCalled();
    expect(searchPins.mock.calls[1][0]).not.toHaveProperty('needScores');
  });

  it('P9. text pins get the same urgencyBoost as search (ISS-2867); none without urgency', async () => {
    const searchPins = jest.fn().mockResolvedValue(pinsResponse);
    const { service, searchHybrid } = build({ searchPins });

    await service.pins({
      headers,
      query: dto({ query: 'rent', urgency: 'U-1' } as any),
    });
    await service.search({
      headers,
      query: dto({ query: 'rent', urgency: 'U-1' } as any),
    });
    expect(searchPins.mock.calls[0][0].urgencyBoost).toEqual({
      code: 'U-1',
      score: 1,
    });
    expect(searchPins.mock.calls[0][0].urgencyBoost).toEqual(
      searchHybrid.mock.calls[0][0].urgencyBoost,
    );

    await service.pins({ headers, query: dto({ query: 'rent' }) });
    expect(searchPins.mock.calls[1][0]).not.toHaveProperty('urgencyBoost');
  });

  it('turns a missing index into a 400', async () => {
    const searchPins = jest.fn().mockRejectedValue({
      meta: { body: { error: { type: 'index_not_found_exception' } } },
    });
    const { service } = build({ searchPins });
    await expect(
      service.pins({ headers, query: dto({ query: 'x' }) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('tenant context (hotlines, top areas)', () => {
  const emergencyScores = {
    signals: {
      needs: { status: 'ok', scores: {} },
      emergency: { status: 'ok', score: 0.99, floor_hit: true },
    },
    scores: {},
    modelVersion: 'mv-1',
  } as ClassifyResult;

  const emergencyHotlines = async (searchConfig: unknown) => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(emergencyScores),
      searchConfig: searchConfig as SearchConfigCache,
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'he is hurting me' }),
    });
    return res.clarification.questions.find((q) => q.id === 'emergency')
      ?.hotlines;
  };

  it('uses the tenant hotlines from the search config', async () => {
    const hotlines = [{ label: 'Local line', number: '555-0100' }];
    expect(await emergencyHotlines({ hotlines })).toEqual(hotlines);
  });

  it.each([
    ['missing', {}],
    ['empty', { hotlines: [] }],
    ['malformed', { hotlines: 'nope' }],
    ['blank entries', { hotlines: [{ label: ' ', number: '' }] }],
  ])('falls back to the default hotlines when %s', async (_n, cfg) => {
    expect(await emergencyHotlines(cfg)).toEqual(DEFAULT_HOTLINES);
  });

  const startOptions = async () => {
    const { service } = build({});
    const res = await service.search({ headers, query: dto({ query: '' }) });
    const q = res.clarification.questions.find((x) => x.id === 'start');
    return q?.options.map((o) => o.value);
  };

  it('offers the global default areas in the start question', async () => {
    // The start question lists every Tier 1 need; the default areas come first.
    expect((await startOptions())?.slice(0, 3)).toEqual(DEFAULT_TOP_AREAS);
    expect(DEFAULT_TOP_AREAS).toEqual(['N-HOU', 'N-FOD', 'N-MON']);
  });

  it('gives every tenant the same start areas', async () => {
    const other = {
      ...headers,
      'x-tenant-id': '22222222-2222-4222-8222-222222222222',
    };
    const { service } = build({});
    const opts = async (h: typeof headers) =>
      (
        await service.search({ headers: h, query: dto({ query: '' }) })
      ).clarification.questions.find((x) => x.id === 'start')?.options;
    expect(await opts(other)).toEqual(await opts(headers));
  });
});

describe('tenantHotlines', () => {
  it('trims, drops blanks, keeps order', () => {
    expect(
      tenantHotlines({
        hotlines: [
          { label: ' A ', number: ' 1 ' },
          { label: '', number: '2' },
          { label: 'B', number: '3' },
        ],
      }),
    ).toEqual([
      { label: 'A', number: '1' },
      { label: 'B', number: '3' },
    ]);
  });
  it('keeps at most 4', () => {
    const hotlines = Array.from({ length: 6 }, (_, i) => ({
      label: `L${i}`,
      number: `${i}`,
    }));
    expect(tenantHotlines({ hotlines })).toHaveLength(4);
  });
  it.each([
    [null],
    [undefined],
    [{}],
    [{ hotlines: null }],
    [{ hotlines: 'x' }],
    [{ hotlines: [1, null, { label: 1, number: 2 }] }],
  ])('malformed %j gives []', (cfg) => {
    expect(tenantHotlines(cfg as SearchConfigCache | null | undefined)).toEqual(
      [],
    );
  });
});

describe('V2_QUESTION_RULE_V1 switch', () => {
  const scores = { 'N-FOD-01': 0.5 };
  const search = () =>
    jest.fn().mockImplementation(async () => ({
      ...hybridResponse(10),
    }));
  const ask = async (ruleV1: string | undefined) => {
    const s = search();
    const b = build({
      ruleV1: ruleV1 ?? 'unset',
      classify: jest.fn().mockResolvedValue(okResult(scores)),
      search: s,
    });
    const res = await b.service.search({
      headers,
      query: dto({ query: 'food' }),
    });
    return { res, call: s.mock.calls[0][0] };
  };

  it("unset: runs development's engine; the hybrid call has no new fields", async () => {
    const { res, call } = await ask(undefined);
    expect(res.rules_version).toBe('rules-2026-11-23.1');
    expect(res.rules_version).not.toBe(RULES_VERSION);
    expect('nullCountsWithoutNeedTags' in call).toBe(false);
  });

  it('switch off: the clarification has no notice and no phone_line keys', async () => {
    const { res } = await ask(undefined);
    expect('notice' in res.clarification).toBe(false);
    expect('phone_line' in res.clarification).toBe(false);
  });

  it("'false' also runs development's engine", async () => {
    expect((await ask('false')).res.rules_version).toBe('rules-2026-11-23.1');
  });

  it("'TRUE' is on (envFlag ignores case)", async () => {
    expect((await ask('TRUE')).res.rules_version).toBe(RULES_VERSION);
  });

  it.each(['true ', '1'])(
    'the value %j is off: development engine',
    async (v) => {
      expect((await ask(v)).res.rules_version).toBe('rules-2026-11-23.1');
    },
  );

  it("'true': runs question rule v1 and asks retrieval for the new fields", async () => {
    const { res, call } = await ask('true');
    expect(res.rules_version).toBe(RULES_VERSION);
    expect(call.nullCountsWithoutNeedTags).toBe(true);
  });
});

describe('question contract v2 in the service', () => {
  const scores = { 'N-FOD-01': 0.5 };
  const ask = async (ruleV1: string, over: Partial<V2SearchQueryDto> = {}) => {
    const b = build({
      ruleV1,
      classify: jest.fn().mockResolvedValue(okResult(scores)),
      search: jest.fn().mockImplementation(async () => ({
        ...hybridResponse(10),
        nameClaim: { status: 'ok', org_ids: [], veto: null, pins: [] },
      })),
    });
    return b.service.search({
      headers,
      query: dto({ query: 'food', ...over }),
    });
  };
  const LEGACY_ONLY = [
    'importance',
    'priority',
    'value',
    'uncertainty',
    'reason',
    'step',
  ];

  it('off: legacy shape (importance, no placement), parity with development', async () => {
    const res: any = await ask('off');
    expect(res.clarification.questions.length).toBeGreaterThan(0);
    for (const q of res.clarification.questions) {
      expect(q).toHaveProperty('importance');
      expect(q).not.toHaveProperty('placement');
    }
    // The exact keys of development's answer.
    expect(Object.keys(res.clarification).sort()).toEqual([
      'questions',
      'rules_version',
    ]);
    expect(Object.keys(res.clarification.questions[0]).sort()).toEqual([
      'allow_other',
      'id',
      'importance',
      'multi_select',
      'none_of_these',
      'options',
      'priority',
      'reason',
      'stem',
      'step',
      'type',
      'uncertainty',
      'value',
    ]);
    expect(
      Object.keys(res.clarification.questions[0].options[0]).sort(),
    ).toEqual(['label', 'parameter', 'results_count', 'value']);
  });

  it('on: placement, and the exact keys of the contract', async () => {
    const res: any = await ask('true');
    expect(res.clarification.questions.length).toBeGreaterThan(0);
    for (const q of res.clarification.questions) {
      expect(['popup', 'before_results', 'with_results']).toContain(
        q.placement,
      );
      expect(['emergency', 'urgency', 'need']).toContain(q.type);
      for (const k of LEGACY_ONLY) expect(q).not.toHaveProperty(k);
      for (const o of q.options) expect(o).not.toHaveProperty('score');
    }
    // This page is R5 (no hit holds the query word): the notice comes with its question.
    expect(Object.keys(res.clarification).sort()).toEqual([
      'notice',
      'phone_line',
      'questions',
      'rules_version',
    ]);
    expect(Object.keys(res.clarification.questions[0]).sort()).toEqual([
      'allow_other',
      'id',
      'multi_select',
      'none_of_these',
      'options',
      'placement',
      'stem',
      'type',
    ]);
  });

  const danger = (score: number, floor_hit: boolean) =>
    okResult(
      {},
      {
        signals: {
          needs: { status: 'ok', scores: {} },
          emergency: { status: 'ok', score, floor_hit },
        },
      },
    );
  const inLang = (lang: string) =>
    ({ ...headers, 'accept-language': lang }) as HeadersDto;

  it('es: danger on the keyword list is a popup with hotlines, in Spanish', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(danger(0.9, true)),
    });
    const res: any = await service.search({
      headers: inLang('es'),
      query: dto({ query: 'ayuda' }),
    });
    expect(res.clarification.questions[0]).toMatchObject({
      id: 'emergency',
      type: 'emergency',
      placement: 'popup',
      stem: '¿Está en peligro en este momento?',
      none_of_these: false,
      hotlines: DEFAULT_HOTLINES,
    });
    expect(isMarkedNotStorable(res)).toBe(true);
  });

  it('no results: no need question; the phone line stays', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(okResult(scores)),
      search: jest.fn().mockResolvedValue({
        ...hybridResponse(0),
        totalCounted: true,
      }),
    });
    const { clarification }: any = await service.search({
      headers,
      query: dto({ query: 'food' }),
    });
    expect(clarification.questions).toEqual([]);
    expect(clarification.phone_line).toEqual({
      label: 'Call 211',
      number: '211',
    });
  });

  it('weak match: no_match comes before the results, with the phone line', async () => {
    const { service } = build({
      search: jest.fn().mockResolvedValue({
        ...hybridResponse(5),
        judges: { keyword_top: 0.4, vector_top: 0.3 },
      }),
    });
    const res: any = await service.search({
      headers,
      query: dto({ query: 'qzxv blorp' }),
    });
    expect(res.weak_match).toBe(true);
    expect(res.clarification.questions).toEqual([
      expect.objectContaining({
        id: 'no_match',
        type: 'need',
        placement: 'before_results',
        none_of_these: true,
      }),
    ]);
    expect(res.clarification.phone_line.number).toBe('211');
  });

  it('the trace holds what the response leaves out; nothing new when off', async () => {
    const setAttribute = jest.fn();
    const span = { setAttribute, setAttributes: jest.fn(), end: jest.fn() };
    const spy = jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (_n: string, _o: object, fn: (s: object) => unknown) =>
        fn(span),
    } as any);
    const questions = () =>
      setAttribute.mock.calls.filter(([k]) => k === 'v2.questions');
    try {
      await ask('off');
      expect(questions()).toEqual([]);
      await ask('true');
      expect(questions()).toHaveLength(1);
      expect(questions()[0][1]).toMatch(
        /^start\|high\|[a-z_]+\|[\d.]+\|[\d.]+$/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('clarify=never: the danger question only, in the new shape', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(danger(0.5, true)),
    });
    const res: any = await service.search({
      headers,
      query: dto({ query: 'help me', clarify: 'never' }),
    });
    expect(
      res.clarification.questions.map((q: any) => [q.id, q.placement]),
    ).toEqual([['emergency', 'before_results']]);
  });
});

describe('match in the service (flag on)', () => {
  const page = (orgs: string[]) => ({
    ...hybridResponse(10),
    search: {
      ...(hybridResponse(10) as any).search,
      hits: {
        total: orgs.length,
        hits: orgs.map((org) => ({
          _source: {
            name: 'Swim',
            organization: { name: org },
            taxonomies: [{ name: 'Recreation' }],
          },
        })),
      },
    },
  });
  const named = {
    nameClaim: { status: 'ok', org_ids: ['o1'], veto: null, pins: [] },
  };
  const ask = async (query: string, orgs: string[], extra = {}) => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-HLT': 0.02 })),
      search: jest.fn().mockResolvedValue({ ...page(orgs), ...extra }),
    });
    const res = await service.search({
      headers,
      query: dto({ query }),
    });
    return res.clarification.questions.map((q) => q.id);
  };

  it('a named org: concentrated (R1), no need question; one org that only fills the page is not', async () => {
    const orgs = [
      ...Array.from({ length: 9 }, () => 'YMCA of Seattle'),
      'Other Org',
    ];
    expect(await ask('ymca', orgs, named)).toEqual([]);
    expect(await ask('ymca', orgs)).not.toEqual([]);
  });
  it('the words are only in org names, not in the hits: none (R5), start stays with notice', async () => {
    const orgs = Array.from({ length: 10 }, (_, i) => `City ${i} Police`);
    expect(await ask('police', orgs)).toEqual(['start']);
  });
  it('R5 sets the notice and the phone line; R1 sets neither', async () => {
    const run = async (query: string, orgs: string[], extra = {}) => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-HLT': 0.02 })),
        search: jest.fn().mockResolvedValue({ ...page(orgs), ...extra }),
      });
      return (await service.search({ headers, query: dto({ query }) }))
        .clarification;
    };
    const r5 = await run(
      'police',
      Array.from({ length: 10 }, (_, i) => `City ${i} Police`),
    );
    expect(r5.notice?.kind).toBe('may_not_match');
    expect(r5.phone_line).toEqual({ label: 'Call 211', number: '211' });
    const r1 = await run(
      'ymca',
      Array.from({ length: 10 }, () => 'YMCA'),
      named,
    );
    expect('notice' in r1).toBe(false);
    expect('phone_line' in r1).toBe(false);
  });
  it('topTexts reads the text (name, description, summary, taxonomy names) and caps at 20', () => {
    const hits = Array.from({ length: 25 }, (_, i) => ({
      _source: {
        name: `N${i}`,
        description: 'D',
        summary: 'S',
        organization: 'Org',
        taxonomies: [{ name: 'Tx' }],
      },
    }));
    const out = topTexts({ search: { hits: { hits } } });
    expect(out).toHaveLength(20);
    expect(out[0]).toBe('N0 D S Tx');
  });
});

// Lucas 2026-11-20: full v2 features only for en and es. Other locales get no
// need questions, no need guesses, and the danger question only on a keyword-floor hit.
describe('V2SearchService limited locales (full v2 only for en and es)', () => {
  const strong = { 'N-FOD': 0.9, 'N-FOD-01': 0.95, 'N-HOU': 0.3 };
  const classified = (floorHit: boolean, score = 0.5): ClassifyResult =>
    okResult(strong, {
      signals: {
        needs: { status: 'ok', scores: strong },
        urgency: { level: 'U-1', score: 0.85 },
        emergency: { status: 'ok', score, floor_hit: floorHit },
      },
    });
  const inLang = (lang: string) =>
    ({ ...headers, 'accept-language': lang }) as HeadersDto;
  const ids = (res: { clarification: { questions: { id: string }[] } }) =>
    res.clarification.questions.map((q) => q.id);

  it('ko "I need food": no danger question, no needs, no need chips', async () => {
    const { service, classify } = build({
      classify: jest.fn().mockResolvedValue(classified(false, 0.9)),
    });
    const res = await service.search({
      headers: inLang('ko'),
      query: dto({ query: '음식이 필요해요' }),
    });
    expect(classify.mock.calls[0][2]).toBe('off');
    expect(res.intent.needs).toEqual([]);
    expect(res.clarification.questions).toEqual([]);
  });

  it('ko with a failed emergency check: the answer is not storable (same as en)', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(errorResult()),
    });
    const res = await service.search({
      headers: inLang('ko'),
      query: dto({ query: '죽고 싶어요' }),
    });
    expect(isMarkedNotStorable(res)).toBe(true);
  });

  // The seam: the list (`run`) and the map pins (`pins`) both go through
  // `classifyAndDecide`, so the limited-locale rule cannot differ between them.
  it.each(['ko', 'ru', 'vi', 'am', 'zh-hans'])(
    '%s: pins classify with AI off and get no need boost, like the list',
    async (lang) => {
      const searchPins = jest.fn().mockResolvedValue({
        total: 0,
        truncated: false,
        pins: [],
      });
      const { service, classify, searchHybrid } = build({
        classify: jest.fn().mockResolvedValue(classified(false, 0.9)),
        searchPins,
      });
      await service.pins({
        headers: inLang(lang),
        query: dto({ query: 'food' }),
      });
      await service.search({
        headers: inLang(lang),
        query: dto({ query: 'food' }),
      });
      expect(classify.mock.calls.map((c) => c[2])).toEqual(['off', 'off']);
      expect(searchPins.mock.calls[0][0].needScores ?? []).toEqual([]);
      expect(searchHybrid.mock.calls[0][0].needScores ?? []).toEqual([]);
    },
  );

  it.each(['en', 'es'])(
    '%s: pins and the list get the same need boost',
    async (lang) => {
      const searchPins = jest.fn().mockResolvedValue({
        total: 0,
        truncated: false,
        pins: [],
      });
      const { service, searchHybrid } = build({
        classify: jest.fn().mockResolvedValue(classified(false, 0.001)),
        searchPins,
      });
      await service.pins({
        headers: inLang(lang),
        query: dto({ query: 'food' }),
      });
      await service.search({
        headers: inLang(lang),
        query: dto({ query: 'food' }),
      });
      const pinScores = searchPins.mock.calls[0][0].needScores;
      expect(pinScores.length).toBeGreaterThan(0);
      expect(pinScores).toEqual(searchHybrid.mock.calls[0][0].needScores);
    },
  );

  it('es keeps needs and questions', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(classified(false, 0.001)),
    });
    const res = await service.search({
      headers: inLang('es'),
      query: dto({ query: 'necesito comida' }),
    });
    expect(res.intent.needs.some((n) => n.source === 'inferred')).toBe(true);
    expect(ids(res).length).toBeGreaterThan(0);
  });

  it('ko crisis phrase on the floor list: the danger question, in Korean, with hotlines', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(classified(true, 0.5)),
    });
    const res = await service.search({
      headers: inLang('ko'),
      query: dto({ query: '죽고 싶어요' }),
    });
    expect(ids(res)).toEqual(['emergency']);
    const q = res.clarification.questions[0];
    expect(q.stem).toBe('지금 위험한 상황에 있으신가요?');
    expect(q.hotlines.map((h) => h.number)).toEqual(['988', '911']);
    expect(res.intent.needs).toEqual([]);
  });

  it('a limited locale with a high model score but no floor hit: no danger question', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(classified(false, 0.99)),
    });
    const res = await service.search({
      headers: inLang('vi'),
      query: dto({ query: 'tôi cần nhà ở' }),
    });
    expect(ids(res)).toEqual([]);
  });

  it('caller U-0 still gets the hotlines in a limited locale', async () => {
    const { service } = build({
      classify: jest.fn().mockResolvedValue(classified(false, 0.1)),
    });
    const res = await service.search({
      headers: inLang('ru'),
      query: dto({ query: 'x', urgency: 'U-0' }),
    });
    expect(ids(res)).toEqual(['emergency']);
    expect(res.clarification.questions[0].hotlines.length).toBe(2);
  });
});

describe('V2SearchService urgency boost (ISS-2867)', () => {
  const withUrgency = (level: string, score: number) =>
    okResult({}, {
      signals: {
        needs: { status: 'ok', scores: {} },
        urgency: { level, score },
        emergency: { status: 'ok', score: 0.001, floor_hit: false },
      },
    } as Partial<ClassifyResult>);
  const boostOf = async (
    classifyResult: ClassifyResult,
    urgency?: string,
  ): Promise<unknown> => {
    const { service, searchHybrid } = build({
      classify: jest.fn().mockResolvedValue(classifyResult),
    });
    await service.search({
      headers,
      query: dto({ query: 'rent', ...(urgency && { urgency }) } as any),
    });
    return searchHybrid.mock.calls[0][0].urgencyBoost;
  };

  it('caller urgency U-1 sends { code U-1, score 1 }', async () => {
    expect(await boostOf(okResult({}), 'U-1')).toEqual({
      code: 'U-1',
      score: 1,
    });
  });

  it('caller U-0 sends no urgencyBoost', async () => {
    expect(await boostOf(okResult({}), 'U-0')).toBeUndefined();
  });

  it('caller U-X with no model urgency sends no urgencyBoost', async () => {
    expect(await boostOf(okResult({}), 'U-X')).toBeUndefined();
  });

  it('inferred urgency at state use sends the model score', async () => {
    expect(await boostOf(withUrgency('U-2', 0.95))).toEqual({
      code: 'U-2',
      score: 0.95,
    });
  });

  it.each([[0.85], [0.5]])(
    'model urgency at state ask or drop (score %p) sends no urgencyBoost',
    async (score) => {
      expect(await boostOf(withUrgency('U-2', score))).toBeUndefined();
    },
  );

  it('needs model failed sends no urgencyBoost', async () => {
    expect(await boostOf(errorResult())).toBeUndefined();
  });

  it('the hybrid call has no urgencyBoost key when there is none', async () => {
    const { service, searchHybrid } = build({});
    await service.search({ headers, query: dto({ query: 'rent' }) });
    expect(searchHybrid.mock.calls[0][0]).not.toHaveProperty('urgencyBoost');
  });
});

describe('V2SearchService name match (question rule v1)', () => {
  const orgHit = (id: string, name: string, text = 'service') => ({
    _source: { name: text, organization: { id, name } },
  });
  const hits = [orgHit('o1', 'Other One'), orgHit('o2', 'Other Two')];
  const page = (extra: Record<string, unknown> = {}) =>
    ({
      search: {
        took: 1,
        timed_out: false,
        _shards: {},
        hits: { total: hits.length, hits },
      },
      facets: [],
      ...extra,
    }) as unknown as SearchResponse;
  const claim = (over: Record<string, unknown> = {}) => ({
    status: 'ok',
    org_ids: ['o1'],
    veto: null,
    pins: ['s1'],
    ...over,
  });
  const ask = async (
    over: {
      ruleV1?: string;
      query?: string;
      claim?: unknown;
      sort?: string;
    } = {},
  ) => {
    const b = build({
      ruleV1: over.ruleV1,
      search: jest
        .fn()
        .mockResolvedValue(
          page('claim' in over ? { nameClaim: over.claim } : {}),
        ),
    });
    const res = await b.service.search({
      headers,
      query: dto({
        query: over.query ?? 'compass housing',
        ...(over.sort && { sort: over.sort as never }),
      }),
    });
    return { res, ...b };
  };
  const call = (m: jest.Mock) => m.mock.calls[0][0];
  const asked = (r: { res: { clarification: { questions: unknown[] } } }) =>
    r.res.clarification.questions.length;

  it('the early start and the search get the same content words', async () => {
    const { searchHybrid, startEarlyRetrieval } = await ask({
      query: 'the compass housing',
    });
    expect(call(searchHybrid).nameWords).toEqual(['compass', 'housing']);
    expect(call(startEarlyRetrieval).nameWords).toBe(
      call(searchHybrid).nameWords,
    );
  });

  it.each([
    ['flag off', { ruleV1: 'off' }],
    ['flag unset', { ruleV1: '' }],
    ['no text', { query: '' }],
    ['one letter', { query: 'a' }],
    ['request words only', { query: 'i need help' }],
    ['a ZIP', { query: '98101' }],
  ])('%s: no name words', async (_n, over) => {
    const { searchHybrid } = await ask(over);
    expect(call(searchHybrid)).not.toHaveProperty('nameWords');
  });

  it('flag off: a claim in the result changes nothing', async () => {
    const off = await ask({ ruleV1: 'off', claim: claim() });
    const none = await ask({ ruleV1: 'off' });
    expect(off.res).toEqual(none.res);
    expect(isMarkedNotStorable(off.res)).toBe(isMarkedNotStorable(none.res));
  });

  it('a named org: no question, stored; the claim never reaches the response', async () => {
    const r = await ask({ claim: claim() });
    expect(asked(r)).toBe(0);
    expect(isMarkedNotStorable(r.res)).toBe(false);
    expect(JSON.stringify(r.res)).not.toContain('nameClaim');
  });

  it.each(['relevance', 'distance', 'name'])(
    'sort=%s: a named org in the radius asks nothing, one outside it runs the grid',
    async (sort) => {
      expect(asked(await ask({ sort, claim: claim() }))).toBe(0);
      // Outside the radius the keyword list has no hit of it: no claim.
      const out = await ask({ sort, claim: claim({ org_ids: [], pins: [] }) });
      expect(asked(out)).toBeGreaterThan(0);
      expect(isMarkedNotStorable(out.res)).toBe(false);
    },
  );

  it.each(['topic', 'generic'])(
    'a claim dropped as %s: the grid asks',
    async (veto) => {
      const r = await ask({ claim: claim({ org_ids: [], pins: [], veto }) });
      expect(asked(r)).toBeGreaterThan(0);
      expect(isMarkedNotStorable(r.res)).toBe(false);
    },
  );

  it('a failed claim, or none with name words: the grid asks, not stored', async () => {
    const failed = claim({ status: 'failed', org_ids: [], pins: [] });
    for (const over of [{ claim: failed }, {}]) {
      const r = await ask(over);
      expect(asked(r)).toBeGreaterThan(0);
      expect(isMarkedNotStorable(r.res)).toBe(true);
    }
  });

  it('the map pins get the same name words as the list; off: none', async () => {
    for (const [ruleV1, words] of [
      ['true', ['compass', 'housing']],
      ['off', undefined],
    ] as const) {
      const b = build({ ruleV1 });
      const query = dto({ query: 'the compass housing' });
      await b.service.pins({ headers, query });
      await b.service.search({ headers, query });
      expect(call(b.searchPins).nameWords).toEqual(words);
      expect(call(b.searchHybrid).nameWords).toEqual(words);
    }
  });

  it('the words held are read on the first relevance page only; a name holds on every page', async () => {
    const none = claim({ org_ids: [], pins: [] });
    const at = async (
      extra: Record<string, unknown>,
      c: unknown,
      lang = 'en',
    ) => {
      const b = build({
        search: jest.fn().mockResolvedValue(page({ nameClaim: c })),
      });
      const res = await b.service.search({
        headers: { ...headers, 'accept-language': lang } as never,
        query: dto({ query: 'zebra', ...extra } as never),
      });
      return res.clarification;
    };
    expect((await at({}, none)).notice?.kind).toBe('may_not_match');
    expect((await at({ page: 2 }, none)).notice).toBeUndefined();
    expect((await at({ sort: 'distance' }, none)).notice).toBeUndefined();
    expect((await at({ page: 9 }, claim())).questions).toEqual([]);
    for (const lang of ['ru', 'ko'])
      expect((await at({}, none, lang)).notice).toBeUndefined();
  });

  it('no name words and no claim: stored (nothing failed)', async () => {
    const r = await ask({ query: 'i need help' });
    expect(isMarkedNotStorable(r.res)).toBe(false);
  });

  it('a pick after a weak match: its own results, so the follow-up question stays and no phone line', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          judges: { keyword_top: 0.4, vector_top: 0.3 },
          nameClaim: claim({ org_ids: [], pins: [] }),
        }),
      )
      .mockResolvedValueOnce(page({ needCounts: { 'N-HOU-01': 1 } }));
    const b = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 })),
      search,
    });
    const res = await b.service.search({
      headers,
      query: dto({ query: 'blorptastic zzz', needs: ['N-HOU'] } as never),
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(res.clarification.questions.map((q) => q.id)).toContain(
      'area:N-HOU',
    );
    expect(res.clarification.phone_line).toBeUndefined();
  });

  it.each([
    ['es', false],
    ['en', true],
  ])(
    'weak match, no pick, %s: the no_match options carry an English description: %p',
    async (lang, english) => {
      const search = jest
        .fn()
        .mockResolvedValueOnce(
          page({
            judges: { keyword_top: 0.4, vector_top: 0.3 },
            nameClaim: claim({ org_ids: [], pins: [] }),
          }),
        )
        .mockResolvedValueOnce(
          page({ needCounts: { 'N-HOU': 10, 'N-FOD': 10 } }),
        );
      const b = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 })),
        search,
      });
      const res = await b.service.search({
        headers: { ...headers, 'accept-language': lang } as never,
        query: dto({ query: 'blorptastic zzz' }),
      });
      expect(res.weak_match).toBe(true);
      const options = res.clarification.questions.flatMap((q) =>
        q.options.filter((o) => o.parameter === 'needs' && o.value !== 'N-X'),
      );
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((o) => 'description' in o)).toBe(english);
    },
  );

  it.each([
    ['a failed claim', { nameClaim: claim({ status: 'failed', org_ids: [] }) }],
    ['no claim', {}],
    ['an ok claim', { nameClaim: claim({ org_ids: [], pins: [] }) }],
  ])('a pick after a weak match with %s', async (name, extra) => {
    const b = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 })),
      search: jest
        .fn()
        .mockResolvedValueOnce(
          page({ judges: { keyword_top: 0.4, vector_top: 0.3 }, ...extra }),
        )
        .mockResolvedValueOnce(page({ needCounts: { 'N-HOU-01': 1 } })),
    });
    const res = await b.service.search({
      headers,
      query: dto({ query: 'blorptastic zzz', needs: ['N-HOU'] } as never),
    });
    expect(b.searchHybrid).toHaveBeenCalledTimes(2);
    // Never cache a degraded result.
    expect(isMarkedNotStorable(res)).toBe(name !== 'an ok claim');
  });

  it.each([
    ['timed out', { timed_out: true }, true],
    ['a failed shard', { _shards: { failed: 1 } }, true],
    ['complete', { _shards: { failed: 0 } }, false],
  ])(
    'the page the question reads: %s; stored only when complete; off: stored',
    async (_n, over, notStored) => {
      for (const ruleV1 of ['true', 'off']) {
        const base = page({ nameClaim: claim() });
        const search = { ...base.search, ...over };
        const b = build({
          ruleV1,
          search: jest.fn().mockResolvedValue({ ...base, search }),
        });
        const res = await b.service.search({
          headers,
          query: dto({ query: 'compass housing' }),
        });
        expect(isMarkedNotStorable(res)).toBe(ruleV1 === 'true' && notStored);
      }
    },
  );

  it.each(['true', 'off'])(
    'an unreadable total (%s): not stored with the rule on; off as before',
    async (ruleV1) => {
      const r = page({ nameClaim: claim(), totalCounted: false });
      const b = build({ ruleV1, search: jest.fn().mockResolvedValue(r) });
      const res = await b.service.search({
        headers,
        query: dto({ query: 'compass housing' }),
      });
      expect(isMarkedNotStorable(res)).toBe(ruleV1 === 'true');
    },
  );

  it.each(['true', 'off'])(
    'a failed count read (%s): not stored with the rule on; never in the response',
    async (ruleV1) => {
      const b = build({
        ruleV1,
        search: jest
          .fn()
          .mockResolvedValue(
            page({ nameClaim: claim(), needCountsFailed: true }),
          ),
      });
      const res = await b.service.search({
        headers,
        query: dto({ query: 'compass housing' }),
      });
      expect(isMarkedNotStorable(res)).toBe(ruleV1 === 'true');
      expect(res).not.toHaveProperty('needCountsFailed');
    },
  );

  it.each([
    ['counts', undefined, 'page'],
    ['counts', undefined, 'count'],
    ['pick', ['N-HOU'], 'page'],
    ['pick', ['N-HOU'], 'count'],
  ])(
    'weak match, second call for the %s (needs %p), %s read cut short: not stored',
    async (_n, needs, cut) => {
      const ok = page({ needCounts: { 'N-HOU': 10, 'N-HOU-01': 1 } });
      const second =
        cut === 'page'
          ? { ...ok, search: { ...ok.search, timed_out: true } }
          : { ...ok, needCountsFailed: true };
      const stored = async (r: unknown) => {
        const b = build({
          classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 })),
          search: jest
            .fn()
            .mockResolvedValueOnce(
              page({
                judges: { keyword_top: 0.4, vector_top: 0.3 },
                nameClaim: claim({ org_ids: [], pins: [] }),
              }),
            )
            .mockResolvedValueOnce(r),
        });
        const res = await b.service.search({
          headers,
          query: dto({
            query: 'blorptastic zzz',
            ...(needs && { needs }),
          } as never),
        });
        expect(b.searchHybrid).toHaveBeenCalledTimes(2);
        expect(res).not.toHaveProperty('needCountsFailed');
        return !isMarkedNotStorable(res);
      };
      expect(await stored(ok)).toBe(true);
      expect(await stored(second)).toBe(false);
    },
  );

  it.each([
    ['en', 'necesito ayuda'],
    ['es', 'necesito ayuda por favor'],
    ['es', 'busco asistencia'],
  ])(
    '%s: %p is request words only, so no name lookup and a stored answer',
    async (lang, query) => {
      const b = build({});
      const res = await b.service.search({
        headers: { ...headers, 'accept-language': lang } as never,
        query: dto({ query }),
      });
      expect(call(b.searchHybrid)).not.toHaveProperty('nameWords');
      expect(isMarkedNotStorable(res)).toBe(false);
    },
  );

  it('the text-free second call (weak match) gets no name words', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          judges: { keyword_top: 0.4, vector_top: 0.3 },
          nameClaim: claim({ org_ids: [], pins: [] }),
        }),
      )
      .mockResolvedValueOnce(page({ needCounts: { 'N-HOU': 10 } }));
    const b = build({
      classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD': 0.1 })),
      search,
    });
    await b.service.search({
      headers,
      query: dto({ query: 'blorptastic zzz' }),
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][0]).toHaveProperty('nameWords');
    expect(search.mock.calls[1][0]).not.toHaveProperty('nameWords');
  });
});

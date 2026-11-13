/* eslint-disable @typescript-eslint/no-require-imports */
import { HeadersDto } from 'src/common/dto/headers.dto';
import { HybridSearchService } from 'src/search/hybrid-search.service';
import { SearchResponse } from 'src/search/dto/search-response.dto';
import { RULES_VERSION } from '../rules';
import {
  ClassifyResult,
  SearchClassificationClient,
} from './search-classification.client';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchService } from './v2-search.service';

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
      hits: { total, hits: [] },
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

function build(opts: { classify?: jest.Mock; search?: jest.Mock }) {
  const classify = opts.classify ?? jest.fn().mockResolvedValue(okResult({}));
  const searchHybrid =
    opts.search ?? jest.fn().mockResolvedValue(hybridResponse());
  const service = new V2SearchService(
    { classify } as unknown as SearchClassificationClient,
    { searchHybrid } as unknown as HybridSearchService,
  );
  return { service, classify, searchHybrid };
}

describe('V2SearchService', () => {
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

  it.each([
    ['a string array', ['rent', 'help']],
    ['a nested AND/OR object', { AND: ['rent', 'help'] }],
  ])('does not classify %s', async (_label, query) => {
    const { service, classify } = build({});
    const res = await service.search({
      headers,
      query: dto({ query } as Partial<V2SearchQueryDto>),
    });
    expect(classify).not.toHaveBeenCalled();
    expect(res.intent.query).toBeNull();
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
    expect(classify).toHaveBeenCalledWith('rent help', headers['x-tenant-id']);
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
        { value: 'N-FOD-01', source: 'caller', state: 'use' },
        expect.objectContaining({
          value: 'N-HOU-02',
          source: 'inferred',
          state: 'use',
          confidence: 0.99,
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
    expect(
      a.clarification.questions.filter((q) =>
        ['find_need', 'narrow'].includes(q.type),
      ),
    ).toEqual([]);
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

    it('counted: a requested code with no count is written as 0 and its option drops', async () => {
      const search = jest.fn().mockImplementation(async (a: any) => ({
        ...hybridResponse(10),
        needCounts: Object.fromEntries(
          (a.countCodes as string[]).map((c) => [c, 0]),
        ),
      }));
      const { service } = build({
        classify: jest.fn().mockResolvedValue(okResult({ 'N-FOD-01': 0.5 })),
        search,
      });
      const res: any = await service.search({
        headers,
        query: dto({ query: 'food' }),
      });
      const needQs = res.clarification.questions.filter((q: any) =>
        ['find_need', 'narrow'].includes(q.type),
      );
      expect(needQs).toHaveLength(0);
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

    it('top-level keys hold no emergency block', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({ headers, query: dto({ query: 'x' }) });
      expect(Object.keys(res).sort()).toEqual([
        'clarification',
        'facets',
        'intent',
        'model_version',
        'rules_version',
        'search',
      ]);
    });
    it('popup band -> emergency question level red, urgency options only', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({ headers, query: dto({ query: 'x' }) });
      const q = emergencyQ(res);
      expect(q.level).toBe('red');
      expect(q).not.toHaveProperty('parameter');
      expect(q.options).toEqual([
        { label: 'Yes, I am in danger', parameter: 'urgency', value: 'U-1' },
        { label: 'No, I am safe now', parameter: 'urgency', value: 'U-3' },
      ]);
      expect(q.hotlines.map((h) => h.number)).toEqual(['988', '911']);
    });
    it('soft band -> emergency question level orange', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.3)),
      });
      const res = await service.search({ headers, query: dto({ query: 'x' }) });
      expect(emergencyQ(res).level).toBe('orange');
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
      expect(q.level).toBe('red');
      expect(q.options).toEqual([]);
      expect(q.hotlines.map((h) => h.number)).toEqual(['988', '911']);
      expect(res.clarification.questions[0].id).toBe('emergency');
    });
    it('caller U-0 + clarify=never -> the popup stays', async () => {
      const { service } = build({});
      const res = await service.search({
        headers,
        query: dto({ query: 'x', urgency: 'U-0', clarify: 'never' }),
      });
      expect(res.clarification.questions.map((q) => q.id)).toEqual([
        'emergency',
      ]);
    });
    it('popup band + caller U-3 -> no emergency question', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'x', urgency: 'U-3' }),
      });
      expect(emergencyQ(res)).toBeUndefined();
    });
    it('popup band + clarify=never -> only the emergency question', async () => {
      const { service } = build({
        classify: jest.fn().mockResolvedValue(withEmergency(0.9)),
      });
      const res = await service.search({
        headers,
        query: dto({ query: 'x', clarify: 'never' }),
      });
      expect(res.clarification.questions.map((q) => q.id)).toEqual([
        'emergency',
      ]);
    });
  });
});

// Lucas 2026-11-13 (question 14): AI classification off for a tenant.
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
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'x' }),
      aiClassification: 'off',
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
    });
    const res = await service.search({
      headers,
      query: dto({ query: 'x' }),
      aiClassification: 'off',
    });
    expect(res.clarification.questions.map((q) => q.id)).toEqual(['emergency']);
    expect(res.clarification.questions[0].level).toBe('red');
    expect(
      res.clarification.questions[0].hotlines.map((h) => h.number),
    ).toEqual(['988', '911']);
  });
  it('off: caller needs still boost and make blocks', async () => {
    const { service, searchHybrid } = build({
      classify: jest.fn().mockResolvedValue(result(0.001)),
    });
    await service.search({
      headers,
      query: dto({ query: 'x', needs: ['N-FOD-01'] }),
      aiClassification: 'off',
    });
    const arg = searchHybrid.mock.calls[0][0];
    expect(arg.needScores).toEqual([
      { code: 'N-FOD-01', tier: 'tier2', score: 1 },
    ]);
    expect(arg.selectedNeeds).toEqual(['N-FOD-01']);
  });
});

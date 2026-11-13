import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Rank gate for the need boost (ISS-2745).
 *
 * Offline: no Elasticsearch, no network. The fixture freezes real Norse hybrid
 * results (base scores) for 500 searches (445 real, de-identified gold queries on
 * 2 tenants, the ones with a need at or above the gate), the need scores the
 * model gave, and the need weight of each hit. For each search the REAL
 * `searchHybrid` builds the boost clauses (gate, K from the top base score,
 * tier 1 factor). The test then adds each clause's contribution to the frozen
 * base score and re-ranks. `rank_feature` with `linear` adds
 * `boost * feature value`, and the feature value is the hit's need weight.
 * Elasticsearch's own scoring is NOT run here; that part is modelled.
 *
 * A guard case fails when the boost pushes a result out of its band:
 *  - name: a base top-3 result for a name search must stay in the top 3;
 *  - need-tagged: a base top-5 result tagged with a gold need must stay in the top 10;
 *  - need-word: a base top-3 result whose name holds a query word must stay in the top 10.
 *
 * Source of ALLOWED_FAILS: HANDOFF-ASSETS/v2-search--index-tagging/
 * boost-gate-remeasure-2026-11-12.md (a 0.1, tier 1 factor 0.5, gate 0.97:
 * 15 fails of 1,817 cases; 1,384 of the cases are in the 500 boosted searches
 * in the fixture, the other 433 cannot move because no boost is sent).
 * Fixture built by eval-data/rank-gate-2026-11-12/freeze_fixture.py.
 * The count is a regression ceiling, not a quality target. Lower it when
 * the boost improves; raise it only with a new measurement and a reason.
 */
const ALLOWED_FAILS = 15;
const TOTAL_CASES_ALL_SEARCHES = 1817;
const SEARCHES_IN_FIXTURE = 500;
const CASES_IN_FIXTURE = 1384;

type Case = [kind: string, index: number, keepTop: number];
type FixtureSearch = {
  id: string;
  tenant: string;
  needs: [string, 'tier1' | 'tier2', number][];
  scores: number[];
  weights: Record<string, Record<string, number>>;
  cases: Case[];
};
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__/need-boost-rank-gate.json'),
    'utf8',
  ),
) as { totalCasesAllSearches: number; searches: FixtureSearch[] };
const searches = fixture.searches;

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;

describe('HybridSearchService need boost — rank gate (ISS-2745)', () => {
  let service: HybridSearchService;
  let topScore = 0;
  let mainRequests: any[] = [];

  beforeAll(async () => {
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve({ hits: { hits: [] } });
      }
      if (req._source === false && req.size === 1) {
        // top base score for the boost (frozen)
        return Promise.resolve({
          hits: { hits: [{ _id: 'top', _score: topScore }] },
        });
      }
      mainRequests.push(req);
      return Promise.resolve({
        took: 1,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
        aggregations: {},
      });
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearch, count: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'EMBEDDING_BASE_URL') return 'https://embed.example';
              if (key === 'EMBEDDING_MODEL') return 'model-x';
              if (key === 'RUNPOD_API_KEY') return 'key';
              if (key === 'NEED_BOOST_ENABLED') return 'true';
              return undefined;
            }),
          },
        },
        {
          provide: TenantConfigService,
          useValue: {
            getFacets: jest.fn().mockResolvedValue([]),
            getSearchConfig: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RequestCacheService,
          useValue: { getOrSet: jest.fn((_k: any, f: any) => f()) },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();
    service = module.get(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  });

  /** Boost clauses the real service sends for one frozen search. */
  const clausesFor = async (s: FixtureSearch) => {
    mainRequests = [];
    topScore = Math.max(...s.scores);
    await service.searchHybrid({
      headers,
      query: {
        query: 'frozen',
        page: 1,
        limit: 25,
        filters: {},
        distance: 0,
        taxonomy: [] as string[],
      } as any,
      needScores: s.needs.map(([code, tier, score]) => ({
        code,
        tier,
        score,
      })),
    });
    const req = mainRequests.find((r) => r._source !== false);
    const q = req.query;
    const should = (q.function_score ? q.function_score.query : q).bool.should;
    return should.filter((c: any) => c.rank_feature) as {
      rank_feature: { field: string; boost: number };
    }[];
  };

  /** Rank of each base index after the boost. Stable sort, like the measurement. */
  const rankAfter = (s: FixtureSearch, clauses: any[]) => {
    const bonus = s.scores.map((_, j) =>
      clauses.reduce((sum, c) => {
        const code = c.rank_feature.field.replace('sune_need_weights.', '');
        return sum + c.rank_feature.boost * (s.weights[code]?.[j] ?? 0);
      }, 0),
    );
    const order = s.scores
      .map((_, j) => j)
      .sort((a, b) => s.scores[b] + bonus[b] - (s.scores[a] + bonus[a]));
    const pos: number[] = [];
    order.forEach((j, p) => (pos[j] = p + 1));
    return pos;
  };

  it('the fixture holds the agreed number of searches and cases', () => {
    expect(searches).toHaveLength(SEARCHES_IN_FIXTURE);
    expect(searches.reduce((n, s) => n + s.cases.length, 0)).toBe(
      CASES_IN_FIXTURE,
    );
    expect(fixture.totalCasesAllSearches).toBe(TOTAL_CASES_ALL_SEARCHES);
  });

  it(`at most ${ALLOWED_FAILS} guard cases leave their band`, async () => {
    const failed: string[] = [];
    let boostedSearches = 0;
    for (const s of searches) {
      const clauses = await clausesFor(s);
      if (clauses.length > 0) boostedSearches++;
      const pos = rankAfter(s, clauses);
      for (const [kind, idx, keepTop] of s.cases) {
        if (pos[idx] > keepTop) {
          failed.push(
            `${s.id}/${s.tenant} ${kind} base#${idx + 1} -> #${pos[idx]} (keep top ${keepTop})`,
          );
        }
      }
    }
    // Every search in the fixture has a need at or above the gate, so the
    // real service must send a boost for each one. Zero would mean the gate
    // or the switch changed and this test no longer guards anything.
    expect(boostedSearches).toBe(SEARCHES_IN_FIXTURE);
    if (failed.length > ALLOWED_FAILS) {
      throw new Error(
        `${failed.length} guard cases fail, ${ALLOWED_FAILS} allowed:\n${failed.join('\n')}`,
      );
    }
  });
});

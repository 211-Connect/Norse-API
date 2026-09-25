/**
 * Live stress test of the Geography filter's internal routes against a real
 * Elasticsearch cluster, production included. Skipped unless NORSE_LIVE_ES=1.
 *
 * Read-only by construction: the ES client is `createReadOnlyClient`, which
 * refuses anything but GET/HEAD and POST `_search`/`_count` before it reaches
 * the wire, and stops at a request budget. Mongo parity (NORSE_LIVE_MONGO=1)
 * goes through `ReadOnlyCollection`. See docs/geography-filter.md.
 *
 * The routes run for real: both internal modules are mounted in a Nest app
 * with the production ValidationPipe and versioning, and only the ES client is
 * swapped for the guarded one. Scenario 6 measures raw `indexed_shape`
 * clauses (border contact, Q53); scenario 8 drives the shipped geography and
 * virtual filters through the routes.
 */
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import { Client, estypes } from '@elastic/elasticsearch';
import request from 'supertest';
import mongoose from 'mongoose';
import { RegionInternalModule } from 'src/region/internal/region.module';
import { ServiceSearchInternalModule } from 'src/service/internal/service-search.module';
import {
  SERVICES_INDEX,
  SERVICE_LIST_SOURCE_FIELDS,
  buildServiceFilter,
  serviceListSort,
} from 'src/service/internal/service-search.query';
import {
  buildAirsTreeFromPathCounts,
  normalizeAirsCode,
} from 'src/service/internal/airs';
import {
  RequestMeter,
  createReadOnlyClient,
} from 'src/common/testing/read-only-elasticsearch';
import { ReadOnlyCollection } from 'src/common/testing/read-only-mongo';
import { interiorGrid, pointsAtDepth } from './interior-points';

const INTERNAL_API_KEY = 'internal-key-for-tests';

const LIVE = process.env.NORSE_LIVE_ES === '1';
const LIVE_MONGO = LIVE && process.env.NORSE_LIVE_MONGO === '1';
const describeLive = LIVE ? describe : describe.skip;

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const TENANT_ID = env('LIVE_TENANT_ID', '5334599c-1be1-4e55-bf86-1f19d56e9da4'); // UWGSL211
const BUDGET = Number(env('LIVE_MAX_REQUESTS', '1500'));
const PAGE_DELAY_MS = Number(env('LIVE_PAGE_DELAY_MS', '100'));
const CONCURRENCY = Math.min(4, Number(env('LIVE_CONCURRENCY', '4')));
const SAMPLES = Math.min(30, Number(env('LIVE_LATENCY_SAMPLES', '30')));
const REPORT_PATH = env(
  'LIVE_REPORT_PATH',
  join(tmpdir(), 'norse-geography-live-report.json'),
);

const GEOGRAPHY_REGIONS = [
  'county:29510', // St. Louis City
  'county:29189', // St. Louis County
  'zip:63110',
  'state:MO',
  'state:KS',
  'county:29095', // Jackson County, MO
];

type Query = estypes.QueryDslQueryContainer;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ES keyword order: unsigned UTF-8 bytes. A null (missing) name sorts first. */
function byteCompare(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function pool<T>(
  n: number,
  work: (i: number) => Promise<T>,
): Promise<T[]> {
  const out: T[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, n) }, async () => {
      while (next < n) {
        const i = next++;
        out[i] = await work(i);
      }
    }),
  );
  return out;
}

function percentiles(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(s[Math.max(0, Math.ceil(q * s.length) - 1)]);
  return {
    n: s.length,
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(s[s.length - 1]),
  };
}

interface Item {
  id: string;
  serviceId: string;
  name: string | null;
  status: string | null;
}
interface Page {
  items: Item[];
  total: number;
  nextCursor: string | null;
}
interface MongoDoc {
  _id: string;
  serviceId: string;
  name?: string | null;
  status?: unknown;
  taxonomyPath?: string[];
  taxonomyCodes?: string[];
}

describeLive('Geography filter routes against live Elasticsearch', () => {
  jest.setTimeout(20 * 60 * 1000);

  let app: INestApplication;
  let baseUrl: string;
  let client: Client;
  let meter: RequestMeter;
  let mongoClient: InstanceType<typeof mongoose.mongo.MongoClient> | undefined;
  let services: ReadOnlyCollection | undefined;
  let writers: string[];
  let mongoDocs: MongoDoc[] | undefined;
  /** The last raw ES response the services made, for scores and sort values. */
  let lastRaw: {
    hits: { hits: { _id: string; _score: number | null; sort?: unknown[] }[] };
  };
  /** The body of the last search the services sent, for its `preference`. */
  let lastSent: { preference?: string } | undefined;
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
  };

  const post = (path: string, body: object) =>
    request(baseUrl)
      .post(path)
      .set('x-api-version', '1')
      .set('x-internal-api-key', INTERNAL_API_KEY)
      .send(body);
  const get = (path: string) =>
    request(baseUrl)
      .get(path)
      .set('x-api-version', '1')
      .set('x-internal-api-key', INTERNAL_API_KEY);

  async function searchPage(body: object): Promise<Page> {
    const res = await post('/internal/services/search', body);
    if (res.status !== 200) {
      throw new Error(`search ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  /** Follows nextCursor; returns the pages seen and the raw hits of each. */
  async function walk(body: object, maxPages: number) {
    const pages: Page[] = [];
    const raw: (typeof lastRaw)['hits']['hits'][] = [];
    const preferences = new Set<string | undefined>();
    let cursor: string | undefined;
    do {
      const page = await searchPage({ ...body, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      preferences.add(lastSent?.preference);
      // ES returns limit + 1 hits; the extra one opens the next page.
      raw.push(lastRaw.hits.hits.slice(0, page.items.length));
      cursor = page.nextCursor ?? undefined;
      if (cursor) await pause(PAGE_DELAY_MS);
    } while (cursor && pages.length < maxPages);
    return { pages, raw, preferences, complete: cursor === undefined };
  }

  /** Two full walks of one query: duplicates, missing and cross-walk drift. */
  async function walkTwice(body: object, maxPages: number) {
    const first = await walk(body, maxPages);
    const again = await walk(body, maxPages);
    const items = first.pages.flatMap((p) => p.items);
    const distinct = new Set(items.map((i) => i.id));
    const total = first.pages[0].total;
    const pageIds = (w: typeof first) =>
      w.pages.map((p) => p.items.map((x) => x.id).join());
    const preferences = new Set([...first.preferences, ...again.preferences]);
    return {
      first,
      items,
      distinct,
      entry: {
        total,
        pagesWalked: first.pages.length,
        complete: first.complete && again.complete,
        distinct: distinct.size,
        duplicateIds: items.length - distinct.size,
        missingVsTotal: total - distinct.size,
        identicalAcrossWalks:
          JSON.stringify(pageIds(first)) === JSON.stringify(pageIds(again)),
        preferences: [...preferences],
      },
    };
  }

  const scope = () => {
    const s = buildServiceFilter({ resourceWriterIds: writers });
    if (!s) throw new Error('empty writer set');
    return s;
  };

  const shapeClause = (
    id: string,
    relation: estypes.GeoShapeRelation = 'intersects',
  ): Query => ({
    geo_shape: {
      service_area: {
        indexed_shape: { index: 'regions', id, path: 'geometry' },
        relation,
      },
    },
  });

  const pointsClause = (coordinates: number[][]): Query => ({
    geo_shape: {
      service_area: {
        shape: { type: 'multipoint', coordinates },
        relation: 'intersects',
      },
    },
  });

  async function countWhere(filter: Query[], mustNot: Query[] = []) {
    const s = scope();
    const res = await client.count({
      index: SERVICES_INDEX,
      query: {
        bool: {
          filter: [...s.filter, ...filter],
          must_not: [...s.must_not, ...mustNot],
        },
      },
    });
    return res.count;
  }

  beforeAll(async () => {
    const node = process.env.ELASTICSEARCH_HOST ?? process.env.ELASTIC_NODE;
    const apiKey =
      process.env.ELASTICSEARCH_API_KEY ?? process.env.ELASTIC_API_KEY;
    if (!node || !apiKey)
      throw new Error(
        'ELASTICSEARCH_HOST and ELASTICSEARCH_API_KEY are required',
      );
    ({ client, meter } = createReadOnlyClient({
      node,
      auth: { apiKey },
      maxRetries: 0,
      requestTimeout: 60_000,
      budget: BUDGET,
    }));

    const original = client.search.bind(client);
    jest.spyOn(client, 'search').mockImplementation((async (
      ...args: unknown[]
    ) => {
      lastSent = args[0] as typeof lastSent;
      const res = await (
        original as (...a: unknown[]) => Promise<typeof lastRaw>
      )(...args);
      lastRaw = res;
      return res;
    }) as never);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: INTERNAL_API_KEY })],
        }),
        ServiceSearchInternalModule,
        RegionInternalModule,
      ],
    })
      .overrideProvider(ElasticsearchService)
      .useValue(client)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: false,
        forbidNonWhitelisted: false,
      }),
    );
    app.enableVersioning({
      type: VersioningType.HEADER,
      header: 'x-api-version',
      defaultVersion: '1',
    });
    // Listening up front: supertest on an unbound server races under concurrency.
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

    const counts = await client.cat.indices({
      index: 'services,regions',
      format: 'json',
      h: 'index,docs.count',
    });
    report.indices = counts;

    // The writer set: every writer with a canonical record under the tenant.
    const agg = await client.search({
      index: SERVICES_INDEX,
      size: 0,
      query: {
        bool: {
          filter: [{ term: { tenant_id: TENANT_ID } }],
          must_not: [{ term: { isCanonicalPublication: false } }],
        },
      },
      aggs: { writers: { terms: { field: 'resourceWriterId', size: 100 } } },
    });
    writers = (
      agg.aggregations?.writers as {
        buckets: { key: string; doc_count: number }[];
      }
    ).buckets.map((b) => b.key);
    report.tenant = { tenantId: TENANT_ID, writers };
    expect(writers.length).toBeGreaterThan(0);

    if (LIVE_MONGO) {
      const uri = process.env.MONGODB_CONNECTION_STRING;
      if (!uri)
        throw new Error('NORSE_LIVE_MONGO=1 needs MONGODB_CONNECTION_STRING');
      mongoClient = new mongoose.mongo.MongoClient(uri, {
        readPreference: 'secondaryPreferred',
      });
      await mongoClient.connect();
      services = new ReadOnlyCollection(
        mongoClient.db('search_engine').collection('services') as never,
      );
    }
  });

  afterAll(async () => {
    report.requests = { sent: meter?.sent, budget: BUDGET };
    report.finishedAt = new Date().toISOString();
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.stdout.write(
      `\nlive report: ${REPORT_PATH} (${meter?.sent} ES requests)\n`,
    );
    await app?.close();
    await client?.close();
    await mongoClient?.close();
  });

  const mongoScope = () => ({
    resourceWriterId: { $in: writers },
    isCanonicalPublication: { $ne: false },
    serviceId: { $type: 'string', $ne: '' },
  });

  it('1. walks every page of the writer set exactly once, in name order', async () => {
    // A Dagster reload rewrites the slice while we page (delete-first until
    // Dagster #604). Counted before and after, so a moving index is reported
    // as such instead of as a paging bug.
    const countBefore = await countWhere([]);
    const { pages, complete } = await walk(
      { resourceWriterIds: writers, limit: 200 },
      1000,
    );
    const countAfter = await countWhere([]);
    if (countBefore !== countAfter || pages[0].total !== countBefore) {
      throw new Error(
        `services changed during the walk (${countBefore} -> ${countAfter}, first page said ${pages[0].total}): a reload is running, retry when it settles`,
      );
    }
    const items = pages.flatMap((p) => p.items);
    const total = pages[0].total;
    const ids = new Set(items.map((i) => i.id));

    let orderViolations = 0;
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1];
      const b = items[i];
      const byName = byteCompare(a.name, b.name);
      if (
        byName > 0 ||
        (byName === 0 && byteCompare(a.serviceId, b.serviceId) >= 0)
      ) {
        orderViolations++;
      }
    }
    const s1: Record<string, unknown> = {
      pages: pages.length,
      total,
      items: items.length,
      distinctIds: ids.size,
      totalsStable: pages.every((p) => p.total === total),
      lastCursorNull: complete,
      nullNames: items.filter((i) => i.name === null).length,
      firstNullIndex: items.findIndex((i) => i.name === null),
      lastNullIndex: items.map((i) => i.name === null).lastIndexOf(true),
      orderViolations,
    };
    report.s1_walk = s1;

    expect(complete).toBe(true);
    expect(s1.totalsStable).toBe(true);
    expect(items).toHaveLength(total);
    expect(ids.size).toBe(total);
    expect(orderViolations).toBe(0);

    // Per-status totals through the route's own status filter.
    const facets = (
      await post('/internal/services/facets', { resourceWriterIds: writers })
    ).body;
    const perStatus: Record<string, number> = {};
    for (const { value } of facets.statuses as { value: string }[]) {
      perStatus[value] = (
        await searchPage({
          resourceWriterIds: writers,
          filter: { statuses: [value] },
          limit: 1,
        })
      ).total;
      await pause(PAGE_DELAY_MS);
    }
    s1.perStatusTotals = perStatus;

    if (!services) return;
    const mongoTotal = await services.countDocuments(mongoScope());
    const mongoStatuses = await services.aggregate<{ _id: unknown; n: number }>(
      [
        { $match: mongoScope() },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ],
    );
    mongoDocs = await services.find<MongoDoc>(mongoScope(), {
      _id: 1,
      serviceId: 1,
      name: 1,
      status: 1,
      taxonomyPath: 1,
      taxonomyCodes: 1,
    });

    const esById = new Map(items.map((i) => [i.id, i]));
    const mongoById = new Map(mongoDocs.map((d) => [String(d._id), d]));
    const onlyInEs = [...esById.keys()].filter((id) => !mongoById.has(id));
    const onlyInMongo = [...mongoById.keys()].filter((id) => !esById.has(id));
    const nameDiffs = [...esById.values()].filter((i) => {
      const m = mongoById.get(i.id);
      return m && (m.name ?? null) !== i.name;
    });
    const statusDiffs = [...esById.values()].filter((i) => {
      const m = mongoById.get(i.id);
      return m && (typeof m.status === 'string' ? m.status : null) !== i.status;
    });

    const mongoOrder = [...mongoDocs].sort(
      (a, b) =>
        byteCompare(a.name ?? null, b.name ?? null) ||
        byteCompare(a.serviceId, b.serviceId),
    );
    const orderMismatches = mongoOrder.filter(
      (d, i) => items[i]?.id !== String(d._id),
    ).length;

    s1.mongo = {
      total: mongoTotal,
      docsFetched: mongoDocs.length,
      totalDiff: total - mongoTotal,
      statuses: Object.fromEntries(
        mongoStatuses.map((r) => [String(r._id), r.n]),
      ),
      onlyInEs: onlyInEs.slice(0, 20),
      onlyInEsCount: onlyInEs.length,
      onlyInMongo: onlyInMongo.slice(0, 20),
      onlyInMongoCount: onlyInMongo.length,
      nameDiffs: nameDiffs.length,
      nameDiffSamples: nameDiffs.slice(0, 5).map((i) => ({
        id: i.id,
        es: i.name,
        mongo: mongoById.get(i.id)?.name,
      })),
      statusDiffs: statusDiffs.length,
      orderPositionsDiffering: orderMismatches,
    };
    expect(mongoTotal).toBe(total);
    expect(onlyInEs).toEqual([]);
    expect(onlyInMongo).toEqual([]);
    expect(orderMismatches).toBe(0);
  });

  it('2. text search: sane totals, score order, every page from the same shard copies', async () => {
    // The multi-word and punctuated texts are the ones whose BM25 scores
    // differed between primary and replica before `preference` pinned a query
    // to one set of copies: "food*" repeated 229 records and hid ~150.
    const texts = [
      'food',
      'housing',
      'ood',
      'FOOD',
      'food pantry',
      'food*',
      'mental health',
      '?',
    ];
    const out: Record<string, unknown> = {};
    const esSets: Record<string, Set<string>> = {};

    for (const text of texts) {
      const body = { resourceWriterIds: writers, text, limit: 200 };
      const { first, items, distinct, entry } = await walkTwice(body, 25);
      const hits = first.raw.flat();
      let sortViolations = 0;
      for (let i = 1; i < hits.length; i++) {
        const [sa, ia] = hits[i - 1].sort as [number, string];
        const [sb, ib] = hits[i].sort as [number, string];
        if (sb > sa || (sb === sa && byteCompare(ia, ib) >= 0))
          sortViolations++;
      }
      esSets[text] = distinct;

      const e: Record<string, unknown> = {
        ...entry,
        sortViolations,
        topScores: hits.slice(0, 3).map((h) => h._score),
        top5: items.slice(0, 5).map((i) => i.name),
      };
      if (mongoDocs && first.complete) {
        // Mongo's filter: a case-insensitive regex of the escaped text.
        const re = new RegExp(
          text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i',
        );
        const mongoContains = mongoDocs.filter(
          (d) => typeof d.name === 'string' && re.test(d.name),
        );
        const missing = mongoContains.filter(
          (d) => !esSets[text].has(String(d._id)),
        );
        e.mongoNameContains = mongoContains.length;
        e.mongoMatchesMissingFromEs = missing.length;
        e.missingSamples = missing.slice(0, 5).map((d) => d.name);
        e.esOnlyViaMultiMatch =
          esSets[text].size - (mongoContains.length - missing.length);
      }
      out[text] = e;
    }
    report.s2_text = out;
    const preferenceOwners = new Map<string, string>();
    for (const text of texts) {
      const entry = out[text] as {
        complete: boolean;
        duplicateIds: number;
        missingVsTotal: number;
        sortViolations: number;
        identicalAcrossWalks: boolean;
        preferences: (string | undefined)[];
      };
      expect(entry.complete).toBe(true);
      expect(entry.duplicateIds).toBe(0);
      expect(entry.missingVsTotal).toBe(0);
      expect(entry.sortViolations).toBe(0);
      expect(entry.identicalAcrossWalks).toBe(true);
      // One preference per query, on every page of both walks.
      expect(entry.preferences).toEqual([expect.any(String)]);
      preferenceOwners.set(entry.preferences[0]!, text);
    }
    // 'food' and 'FOOD' differ in the fingerprint, so every text has its own.
    expect(preferenceOwners.size).toBe(texts.length);

    const food = out.food as { total: number };
    const upper = out.FOOD as { total: number };
    expect(upper.total).toBe(food.total);
    expect((out.ood as { total: number }).total).toBeGreaterThan(0);
    for (const text of texts) {
      const entry = out[text] as { mongoMatchesMissingFromEs?: number };
      if (entry.mongoMatchesMissingFromEs !== undefined) {
        expect(entry.mongoMatchesMissingFromEs).toBe(0);
      }
    }
  });

  it('3. facets agree with the same aggregation over Mongo', async () => {
    const res = await post('/internal/services/facets', {
      resourceWriterIds: writers,
    });
    expect(res.status).toBe(200);
    const es = res.body as {
      contributors: { resourceWriterId: string; recordCount: number }[];
      statuses: { value: string; recordCount: number }[];
      taxonomy: {
        code: string;
        parentCode: string | null;
        recordCount: number;
        synthesized: boolean;
      }[];
    };
    const s3: Record<string, unknown> = {
      contributors: es.contributors,
      statuses: es.statuses,
      taxonomyNodes: es.taxonomy.length,
    };
    report.s3_facets = s3;
    if (!services || !mongoDocs) return;

    const contributors = await services.aggregate<{ _id: string; n: number }>([
      { $match: mongoScope() },
      { $group: { _id: '$resourceWriterId', n: { $sum: 1 } } },
    ]);
    const statuses = await services.aggregate<{ _id: string; n: number }>([
      { $match: { ...mongoScope(), status: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);

    // Taxonomy from the projected docs, as the Mongo adapter's $unwind/$group
    // would count it (one per array element), and per distinct element.
    const perElement = new Map<string, number>();
    const perDoc = new Map<string, number>();
    const coded = new Set<string>();
    let docsWithDuplicatePath = 0;
    for (const d of mongoDocs) {
      const path = d.taxonomyPath ?? [];
      if (new Set(path).size !== path.length) docsWithDuplicatePath++;
      for (const p of path) perElement.set(p, (perElement.get(p) ?? 0) + 1);
      for (const p of new Set(path)) perDoc.set(p, (perDoc.get(p) ?? 0) + 1);
      for (const c of d.taxonomyCodes ?? []) coded.add(normalizeAirsCode(c));
    }
    const mongoTree = buildAirsTreeFromPathCounts(
      [...perElement].map(([code, recordCount]) => ({ code, recordCount })),
      coded,
    );

    const diff = <T>(
      a: Map<string, T>,
      b: Map<string, T>,
      eq: (x: T, y: T) => boolean,
    ) => {
      const out: { key: string; es?: T; mongo?: T }[] = [];
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(k);
        const y = b.get(k);
        if (x === undefined || y === undefined || !eq(x, y))
          out.push({ key: k, es: x, mongo: y });
      }
      return out;
    };
    const contributorDiffs = diff(
      new Map(es.contributors.map((c) => [c.resourceWriterId, c.recordCount])),
      new Map(contributors.map((c) => [c._id, c.n])),
      (x, y) => x === y,
    );
    const statusDiffs = diff(
      new Map(es.statuses.map((s) => [s.value, s.recordCount])),
      new Map(statuses.map((s) => [s._id, s.n])),
      (x, y) => x === y,
    );
    const nodeKey = (n: {
      parentCode: string | null;
      recordCount: number;
      synthesized: boolean;
    }) => `${n.parentCode}|${n.recordCount}|${n.synthesized}`;
    const taxonomyDiffs = diff(
      new Map(es.taxonomy.map((n) => [n.code, nodeKey(n)])),
      new Map(mongoTree.map((n) => [n.code, nodeKey(n)])),
      (x, y) => x === y,
    );
    Object.assign(s3, {
      mongoTaxonomyNodes: mongoTree.length,
      docsWithDuplicateTaxonomyPath: docsWithDuplicatePath,
      pathCountsDifferingPerElementVsPerDoc: [...perElement].filter(
        ([k, n]) => perDoc.get(k) !== n,
      ).length,
      contributorDiffs,
      statusDiffs,
      taxonomyDiffCount: taxonomyDiffs.length,
      taxonomyDiffSamples: taxonomyDiffs.slice(0, 20),
    });
    expect(contributorDiffs).toEqual([]);
    expect(statusDiffs).toEqual([]);
    expect(taxonomyDiffs).toEqual([]);
  });

  it('4. a tampered or foreign cursor is 400 and never reaches ES', async () => {
    const base = { resourceWriterIds: writers, limit: 5 };
    const cursor = (await searchPage(base)).nextCursor as string;
    const foodCursor = (await searchPage({ ...base, text: 'food' }))
      .nextCursor as string;
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        m: 'name',
        k: '0000000000000000',
        s: [null, 'x'],
      }),
    ).toString('base64url');
    const mid = Math.floor(cursor.length / 2);
    const flipped =
      cursor.slice(0, mid) +
      (cursor[mid] === 'A' ? 'B' : 'A') +
      cursor.slice(mid + 1);

    const cases: [string, object][] = [
      ['one character flipped', { ...base, cursor: flipped }],
      ['not base64 JSON', { ...base, cursor: 'not-a-cursor!!' }],
      ['forged fingerprint', { ...base, cursor: forged }],
      ['name cursor with text', { ...base, text: 'food', cursor }],
      [
        'food cursor with housing',
        { ...base, text: 'housing', cursor: foodCursor },
      ],
      [
        'cursor with a status filter added',
        { ...base, filter: { statuses: ['active'] }, cursor },
      ],
      [
        'cursor with a writer added',
        { ...base, resourceWriterIds: [...writers, 'x'], cursor },
      ],
    ];
    const results: Record<string, number> = {};
    const before = meter.sent;
    for (const [name, body] of cases) {
      results[name] = (await post('/internal/services/search', body)).status;
    }
    const esCallsDuringBadCursors = meter.sent - before;
    const sameQueryOtherLimit = (
      await post('/internal/services/search', { ...base, limit: 7, cursor })
    ).status;
    report.s4_cursor = {
      results,
      esCallsDuringBadCursors,
      sameQueryOtherLimit,
    };

    // A single flipped character can still decode to the same payload.
    for (const [name, status] of Object.entries(results)) {
      if (name !== 'one character flipped') expect(status).toBe(400);
    }
    expect(esCallsDuringBadCursors).toBe(
      results['one character flipped'] === 400 ? 0 : 1,
    );
    expect(sameQueryOtherLimit).toBe(200);
  });

  it('5. region typeahead and lookup match the rankings recorded in PR #217', async () => {
    // [query, expected top ids or names in order, limit]
    const expected: [string, string[], number][] = [
      ['q=jackson mo', ['county:29095', 'zip:63755', 'zip:22842'], 5],
      [
        'q=jack',
        [
          'Jackson County, AL',
          'Jackson County, AR',
          'Jackson County, CO',
          'Jackson County, FL',
          'Jackson County, GA',
        ],
        5,
      ],
      [
        'q=st louis',
        ['St. Louis County, MN', 'St. Louis County, MO', 'St. Louis City, MO'],
        3,
      ],
      [
        'q=MO',
        [
          'state:MO',
          'state:MT',
          'Mobile County, AL',
          'Monroe County, AL',
          'Montgomery County, AL',
        ],
        5,
      ],
      [
        'q=missouri',
        ['state:MO', 'zip:51555', 'zip:64072', 'zip:77459', 'zip:77489'],
        5,
      ],
      ['q=64130', ['zip:64130'], 5],
      [
        'q=641',
        ['zip:64101', 'zip:64102', 'zip:64105', 'zip:64106', 'zip:64108'],
        5,
      ],
      [
        'q=kan',
        [
          'state:KS',
          'Kane County, IL',
          'Kankakee County, IL',
          'Kanabec County, MN',
          'Kandiyohi County, MN',
        ],
        5,
      ],
      [
        'q=new',
        ['state:NH', 'state:NJ', 'state:NM', 'state:NY', 'Newton County, AR'],
        5,
      ],
      [
        'q=ok',
        [
          'state:OK',
          'Okaloosa County, FL',
          'Okeechobee County, FL',
          'Oktibbeha County, MS',
          'Adair County, OK',
        ],
        5,
      ],
      [
        'q=jack&states=MO',
        [
          'county:29095',
          'zip:63755',
          'zip:64070',
          'zip:65260',
          'Jackson County, AL',
          'Jackson County, AR',
          'Jackson County, CO',
          'Jackson County, FL',
          'Jackson County, GA',
          'Jackson County, IL',
        ],
        10,
      ],
    ];
    const typeahead: Record<string, unknown> = {};
    const drift: string[] = [];
    for (const [query, want, limit] of expected) {
      const res = await get(
        `/internal/regions?${query.replace(/ /g, '%20')}&limit=${limit}`,
      );
      expect(res.status).toBe(200);
      const items = res.body.items as { id: string; name: string }[];
      const scores = lastRaw?.hits.hits.map((h) => h._score);
      const got = items.map((it, i) =>
        want[i]?.includes(':') ? it.id : it.name,
      );
      const ok =
        JSON.stringify(got.slice(0, want.length)) === JSON.stringify(want);
      if (!ok) drift.push(query);
      typeahead[query] = {
        ok,
        items: items.map(
          (it, i) => `${it.id} ${it.name} (${scores?.[i] ?? '-'})`,
        ),
      };
      await pause(PAGE_DELAY_MS);
    }

    const lookups: Record<string, unknown> = {};
    for (const id of [
      'state:MO',
      'county:29510',
      'zip:63110',
      'county%3A29095',
    ]) {
      const res = await get(`/internal/regions/${id}`);
      lookups[id] = {
        status: res.status,
        name: res.body.name,
        geometryType: res.body.geometry?.type,
        geometryBytes: JSON.stringify(res.body.geometry ?? {}).length,
        attribution: res.body.attribution?.text ?? null,
      };
    }
    const before = meter.sent;
    const errors: Record<string, number> = {};
    for (const id of ['county:123', 'state:mo', 'MO', 'zip:6413', 'city:x']) {
      errors[id] = (await get(`/internal/regions/${id}`)).status;
    }
    const esCallsForMalformed = meter.sent - before;
    for (const id of ['county:99999', 'zip:00000', 'state:ZZ']) {
      errors[id] = (await get(`/internal/regions/${id}`)).status;
    }
    report.s5_regions = {
      typeahead,
      drift,
      lookups,
      errors,
      esCallsForMalformed,
    };

    expect(drift).toEqual([]);
    for (const id of [
      'state:MO',
      'county:29510',
      'zip:63110',
      'county%3A29095',
    ]) {
      expect((lookups[id] as { status: number }).status).toBe(200);
    }
    expect(errors['county:123']).toBe(400);
    expect(errors['state:mo']).toBe(400);
    expect(errors['MO']).toBe(400);
    expect(errors['zip:6413']).toBe(400);
    expect(esCallsForMalformed).toBe(0);
    expect(errors['county:99999']).toBe(404);
    expect(errors['zip:00000']).toBe(404);
    expect(errors['state:ZZ']).toBe(404);
  });

  it('6. ISS-1873 preview: indexed_shape geography counts and border touching (Q53)', async () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const id of GEOGRAPHY_REGIONS) {
      counts[id] = {
        intersects: await countWhere([shapeClause(id)]),
        within: await countWhere([shapeClause(id, 'within')]),
        contains: await countWhere([shapeClause(id, 'contains')]),
      };
      await pause(PAGE_DELAY_MS);
    }
    const inScope = await countWhere([]);
    const withArea = await countWhere([{ exists: { field: 'service_area' } }]);
    const anyOf = await countWhere([
      {
        bool: {
          should: GEOGRAPHY_REGIONS.map((id) => shapeClause(id)),
          minimum_should_match: 1,
        },
      },
    ]);
    let unknownRegion: string;
    try {
      await countWhere([shapeClause('county:99999')]);
      unknownRegion = 'no error';
    } catch (e) {
      unknownRegion = String((e as Error).message).slice(0, 300);
    }

    // Q53: how many intersecting services only touch the Region, or overlap it
    // by a sliver, measured by whether they reach grid points at a depth.
    const border: Record<string, unknown> = {};
    // [Region, a neighbour]: a service whose area lies entirely within the
    // neighbour can reach the Region only along the shared edge.
    const pairs: [string, string][] = [
      ['zip:63110', 'county:29189'],
      ['county:29510', 'county:29189'],
      ['state:KS', 'state:MO'],
    ];
    for (const [id, neighbour] of pairs) {
      const detail = (await get(`/internal/regions/${id}`)).body;
      const grid = interiorGrid(detail.geometry, 6000);
      const maxDepth = Math.max(...grid.points.map((p) => p.depth));
      const byDepth: Record<string, number> = {};
      for (const depth of [0, 100, 250, 500, 1000, 5000]) {
        if (depth > maxDepth) continue;
        byDepth[`${depth}m`] = await countWhere([
          pointsClause(pointsAtDepth(grid, depth, 1500)),
        ]);
      }
      const shallow = pointsClause(pointsAtDepth(grid, 100, 1500));
      const edgeOnly = await countWhere([shapeClause(id)], [shallow]);
      const edgeOnlyAlsoIntersectNeighbour = await countWhere(
        [shapeClause(id), shapeClause(neighbour)],
        [shallow],
      );
      const withinNeighbour = await countWhere([
        shapeClause(id),
        shapeClause(neighbour, 'within'),
      ]);
      const sample = await client.search({
        index: SERVICES_INDEX,
        size: 10,
        _source: ['serviceId', 'name'],
        query: {
          bool: {
            filter: [...scope().filter, shapeClause(id)],
            must_not: [...scope().must_not, shallow],
          },
        },
      });
      border[id] = {
        neighbour,
        gridSpacingM: Math.round(grid.spacingM),
        gridPoints: grid.points.length,
        maxDepthM: Math.round(maxDepth),
        intersects: counts[id]?.intersects,
        reachingPointsAtDepth: byDepth,
        edgeOnlyOrSliverUnder100m: edgeOnly,
        ofWhichAlsoIntersectNeighbour: edgeOnlyAlsoIntersectNeighbour,
        intersectingButWithinNeighbour: withinNeighbour,
        edgeOnlySamples: sample.hits.hits.map(
          (h) => (h._source as { name?: string })?.name,
        ),
      };
      await pause(PAGE_DELAY_MS);
    }
    report.s6_geography = {
      inScope,
      withArea,
      withoutArea: inScope - withArea,
      counts,
      anyOfSix: anyOf,
      unknownRegion,
      border,
    };

    const c = (id: string) => counts[id].intersects;
    expect(c('state:MO')).toBeGreaterThanOrEqual(c('county:29510'));
    expect(c('state:MO')).toBeGreaterThanOrEqual(c('county:29189'));
    expect(c('state:MO')).toBeGreaterThanOrEqual(c('zip:63110'));
    expect(c('state:MO')).toBeGreaterThanOrEqual(c('county:29095'));
    expect(c('state:KS')).toBeLessThan(c('state:MO'));
    expect(anyOf).toBeLessThanOrEqual(withArea);
    expect(anyOf).toBeGreaterThanOrEqual(c('state:MO'));
  });

  it('8. geography and virtual filters through the routes (ISS-1873, ISS-1874)', async () => {
    const totalFor = async (filter: object) =>
      (await searchPage({ resourceWriterIds: writers, filter, limit: 1 }))
        .total;
    const facetSum = async (filter: object) => {
      const res = await post('/internal/services/facets', {
        resourceWriterIds: writers,
        filter,
      });
      expect(res.status).toBe(200);
      return (res.body.contributors as { recordCount: number }[]).reduce(
        (n, c) => n + c.recordCount,
        0,
      );
    };

    const regions: Record<string, unknown> = {};
    for (const id of ['county:29510', 'zip:63110', 'state:MO']) {
      const filter = { geography: { regionIds: [id] } };
      const route = await totalFor(filter);
      const direct = await countWhere([shapeClause(id)]);
      regions[id] = {
        route,
        direct,
        facetContributorSum: await facetSum(filter),
      };
      await pause(PAGE_DELAY_MS);
    }
    const cityOrCounty = await totalFor({
      geography: { regionIds: ['county:29510', 'county:29189'] },
    });
    const county = await countWhere([shapeClause('county:29189')]);

    const virtual: Record<string, unknown> = {};
    for (const [mode, term] of [
      ['only', 'virtual'],
      ['exclude', 'physical'],
    ] as const) {
      const route = await totalFor({ virtual: mode });
      const direct = await countWhere([{ term: { locationTypes: term } }]);
      virtual[mode] = { route, direct };
    }
    virtual.all = await totalFor({ virtual: 'all' });
    const combined = await totalFor({
      geography: { regionIds: ['state:MO'] },
      virtual: 'exclude',
    });
    const combinedDirect = await countWhere([
      shapeClause('state:MO'),
      { term: { locationTypes: 'physical' } },
    ]);

    // Paging under a geography filter, with text: the preference covers it.
    const paged = await walkTwice(
      {
        resourceWriterIds: writers,
        filter: { geography: { regionIds: ['county:29510'] } },
        text: 'food pantry',
        limit: 50,
      },
      25,
    );

    const before = meter.sent;
    const malformed = await post('/internal/services/search', {
      resourceWriterIds: writers,
      filter: { geography: { regionIds: ['city:x'] } },
    });
    const esCallsForMalformed = meter.sent - before;
    const unknown = await post('/internal/services/search', {
      resourceWriterIds: writers,
      filter: { geography: { regionIds: ['county:29510', 'county:99999'] } },
    });
    const unknownFacets = await post('/internal/services/facets', {
      resourceWriterIds: writers,
      filter: { geography: { regionIds: ['zip:00000'] } },
    });

    report.s8_geography_routes = {
      regions,
      cityOrCounty,
      county,
      virtual,
      stateMoExcludeVirtual: { route: combined, direct: combinedDirect },
      pagedCountyFoodPantry: paged.entry,
      malformed: { status: malformed.status, esCallsForMalformed },
      unknown: { status: unknown.status, message: unknown.body?.message },
      unknownFacets: {
        status: unknownFacets.status,
        message: unknownFacets.body?.message,
      },
    };

    for (const id of Object.keys(regions)) {
      const r = regions[id] as {
        route: number;
        direct: number;
        facetContributorSum: number;
      };
      expect(r.route).toBe(r.direct);
      expect(r.route).toBeGreaterThan(0);
      expect(r.facetContributorSum).toBe(r.route);
    }
    expect(cityOrCounty).toBe(county);
    for (const mode of ['only', 'exclude']) {
      const v = virtual[mode] as { route: number; direct: number };
      expect(v.route).toBe(v.direct);
    }
    expect(virtual.all).toBe(await countWhere([]));
    expect(combined).toBe(combinedDirect);
    expect(paged.entry.complete).toBe(true);
    expect(paged.entry.duplicateIds).toBe(0);
    expect(paged.entry.missingVsTotal).toBe(0);
    expect(paged.entry.identicalAcrossWalks).toBe(true);
    expect(malformed.status).toBe(400);
    expect(esCallsForMalformed).toBe(0);
    expect(unknown.status).toBe(400);
    expect(String(unknown.body?.message)).toContain('county:99999');
    expect(String(unknown.body?.message)).not.toContain('county:29510');
    expect(unknownFacets.status).toBe(400);
  });

  it('7. latency', async () => {
    const time = async (run: () => Promise<unknown>) => {
      const t = performance.now();
      await run();
      return performance.now() - t;
    };
    const ok = (status: number) => {
      if (status !== 200) throw new Error(`status ${status}`);
    };
    const texts = ['food', 'housing', 'ood', 'shelter', 'legal'];
    const typeaheads = [
      'jack',
      'jackson mo',
      '641',
      'st louis',
      'kan',
      'missouri',
      'new',
      'ok',
    ];
    const byIds = ['county:29510', 'zip:63110', 'state:MO'];

    const geoSearch = (id: string) => () => {
      const s = scope();
      return client.search({
        index: SERVICES_INDEX,
        size: 51,
        track_total_hits: true,
        _source: SERVICE_LIST_SOURCE_FIELDS,
        query: {
          bool: {
            filter: [...s.filter, shapeClause(id)],
            must_not: s.must_not,
          },
        },
        sort: serviceListSort('name'),
      });
    };

    const runs: Record<string, (i: number) => () => Promise<unknown>> = {
      searchPage: () => async () =>
        ok(
          (
            await post('/internal/services/search', {
              resourceWriterIds: writers,
            })
          ).status,
        ),
      textPage: (i) => async () =>
        ok(
          (
            await post('/internal/services/search', {
              resourceWriterIds: writers,
              text: texts[i % texts.length],
            })
          ).status,
        ),
      facets: () => async () =>
        ok(
          (
            await post('/internal/services/facets', {
              resourceWriterIds: writers,
            })
          ).status,
        ),
      typeahead: (i) => async () =>
        ok(
          (
            await get(
              `/internal/regions?q=${encodeURIComponent(typeaheads[i % typeaheads.length])}&states=MO`,
            )
          ).status,
        ),
      byId: (i) => async () =>
        ok((await get(`/internal/regions/${byIds[i % byIds.length]}`)).status),
      ...Object.fromEntries(
        GEOGRAPHY_REGIONS.map((id) => [`geo ${id}`, () => geoSearch(id)]),
      ),
    };

    const latency: Record<string, unknown> = {
      concurrency: CONCURRENCY,
      samples: SAMPLES,
    };
    for (const [name, make] of Object.entries(runs)) {
      const ms = await pool(SAMPLES, (i) => time(make(i)));
      latency[name] = percentiles(ms);
      await pause(500);
    }
    report.s7_latency = latency;
  });
});

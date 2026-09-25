import { ElasticsearchService } from '@nestjs/elasticsearch';
import { buildAirsTreeFromPathCounts, normalizeAirsCode } from './airs';
import { ServiceSearchService } from './service-search.service';

/**
 * Parity with ServiceNet's Mongo record source (`sharing-mongo/src/record-source.ts`)
 * for the same inputs.
 *
 * `mongo*` below restate that adapter's `buildQuery`, `listRecords` sort/skip/limit
 * and `listFilterOptions` aggregations as predicates over a fixture. `evaluate*`
 * run the request this service actually sends to ES over the same fixture, using
 * the ES semantics that matter here: `terms` matches any array element, `exists`
 * is false for a missing field, `missing: '_first'`, keyword order is byte order,
 * and a composite bucket counts a document once per distinct value.
 *
 * Text search is excluded: it is the one deliberate change (name regex ->
 * multi_match), and the evaluator refuses a clause it does not model rather than
 * guessing at it.
 */

type Doc = Record<string, unknown>;

const A = 'writer-a';
const B = 'writer-b';
const C = 'writer-c';

const FIXTURE: Doc[] = [
  {
    _id: 't:s1',
    serviceId: 's1',
    resourceWriterId: A,
    name: 'Food Bank',
    status: 'active',
    taxonomyPath: ['BD-1800', 'BD'],
    taxonomyCodes: ['BD-1800.'],
  },
  {
    _id: 't:s2',
    serviceId: 's2',
    resourceWriterId: A,
    isCanonicalPublication: true,
    name: 'Food Bank',
    status: 'active',
    taxonomyPath: ['BD-1800.2000', 'BD-1800', 'BD'],
    taxonomyCodes: ['BD-1800.2000'],
  },
  {
    _id: 't:s0',
    serviceId: 's0',
    resourceWriterId: A,
    isCanonicalPublication: true,
    name: 'Food Bank',
    status: 'inactive',
    taxonomyPath: ['BD-1800', 'BD'],
    taxonomyCodes: ['BD-1800'],
  },
  {
    _id: 't:s3',
    serviceId: 's3',
    resourceWriterId: A,
    isCanonicalPublication: true,
    name: 'apple pantry',
    status: '',
    taxonomyPath: ['BD-18', 'BD'],
    taxonomyCodes: ['BD-18'],
  },
  {
    _id: 't:s4',
    serviceId: 's4',
    resourceWriterId: A,
    status: 'active',
    taxonomyPath: [],
    taxonomyCodes: [],
  },
  {
    _id: 'u:s5',
    serviceId: 's5',
    resourceWriterId: A,
    isCanonicalPublication: false,
    name: 'Aardvark',
    status: 'active',
    taxonomyPath: ['BD'],
    taxonomyCodes: ['BD'],
  },
  {
    _id: 't:',
    serviceId: '',
    resourceWriterId: A,
    name: 'Zed',
    status: 'active',
    taxonomyPath: ['BD'],
    taxonomyCodes: ['BD'],
  },
  {
    _id: 't:none',
    resourceWriterId: A,
    name: 'Yak',
    status: 'active',
    taxonomyPath: ['BD'],
    taxonomyCodes: ['BD'],
  },
  {
    _id: 't:s7',
    serviceId: 's7',
    resourceWriterId: A,
    name: 'Beta',
    taxonomyPath: ['BD-1800', 'BD'],
    taxonomyCodes: ['BD-1800'],
  },
  {
    _id: 'v:t1',
    serviceId: 't1',
    resourceWriterId: B,
    name: 'Zulu Shelter',
    status: 'active',
    taxonomyPath: ['Serbo-Croatian'],
    taxonomyCodes: ['Serbo-Croatian'],
  },
  {
    _id: 'v:t2',
    serviceId: 't2',
    resourceWriterId: B,
    name: 'Émigré Help',
    status: 'active',
    taxonomyPath: ['LR-8000', 'LR'],
    taxonomyCodes: ['LR-8000'],
  },
  {
    _id: 'v:t3',
    serviceId: 't3',
    resourceWriterId: B,
    isCanonicalPublication: true,
    name: 'Food Bank',
    status: 'closed',
    taxonomyPath: ['BD-1800', 'BD'],
    taxonomyCodes: ['BD-1800'],
  },
  {
    _id: 'w:u1',
    serviceId: 'u1',
    resourceWriterId: C,
    name: 'Also Food',
    status: 'active',
    taxonomyPath: ['BD'],
    taxonomyCodes: ['BD'],
  },
];

// --- Mongo reference: ServiceNet's current semantics -----------------------

const byteCompare = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** Mongo ascending: a missing/null value sorts before any string. */
function mongoCompareField(a: unknown, b: unknown): number {
  const aMissing = typeof a !== 'string';
  const bMissing = typeof b !== 'string';
  if (aMissing || bMissing)
    return aMissing === bMissing ? 0 : aMissing ? -1 : 1;
  return byteCompare(a as string, b as string);
}

const inOrContains = (value: unknown, list: readonly unknown[]) =>
  Array.isArray(value)
    ? value.some((v) => list.includes(v))
    : list.includes(value);

function mongoMatches(
  doc: Doc,
  input: { writers: string[]; codes: string[]; statuses: string[] },
): boolean {
  if (!input.writers.includes(doc.resourceWriterId as string)) return false;
  if (doc.isCanonicalPublication === false) return false;
  if (input.codes.length > 0 && !inOrContains(doc.taxonomyPath, input.codes))
    return false;
  if (input.statuses.length > 0 && !inOrContains(doc.status, input.statuses))
    return false;
  return typeof doc.serviceId === 'string' && doc.serviceId !== '';
}

function mongoListRecords(input: {
  writers: string[];
  codes: string[];
  statuses: string[];
  offset: number;
  limit: number;
}) {
  if (input.writers.length === 0) return { ids: [] as string[], total: 0 };
  const matched = FIXTURE.filter((d) => mongoMatches(d, input)).sort(
    (a, b) =>
      mongoCompareField(a.name, b.name) ||
      mongoCompareField(a.serviceId, b.serviceId),
  );
  return {
    ids: matched
      .slice(input.offset, input.offset + input.limit)
      .map((d) => d._id as string),
    total: matched.length,
  };
}

function mongoListFilterOptions(writers: string[]) {
  if (writers.length === 0)
    return { contributors: [], statuses: [], taxonomy: [] };
  const matched = FIXTURE.filter((d) =>
    mongoMatches(d, { writers, codes: [], statuses: [] }),
  );
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m];
  };
  const contributors = count(matched.map((d) => d.resourceWriterId as string));
  const statuses = count(
    matched
      .map((d) => d.status)
      .filter((s): s is string => typeof s === 'string' && s !== ''),
  );
  const paths = count(
    matched.flatMap((d) => (d.taxonomyPath as string[]) ?? []),
  );
  const coded = new Set(
    matched
      .flatMap((d) => (d.taxonomyCodes as string[]) ?? [])
      .map(normalizeAirsCode),
  );
  return {
    contributors: contributors
      .map(([resourceWriterId, recordCount]) => ({
        resourceWriterId,
        recordCount,
      }))
      .sort((a, b) => a.resourceWriterId.localeCompare(b.resourceWriterId)),
    statuses: statuses
      .map(([value, recordCount]) => ({ value, recordCount }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    taxonomy: buildAirsTreeFromPathCounts(
      paths.map(([code, recordCount]) => ({ code, recordCount })),
      coded,
    ).map((n) => ({ ...n, name: n.code })),
  };
}

// --- ES evaluator: the request this service sends, run over the fixture -----

const fieldOf = (field: string) => (field === 'name.raw' ? 'name' : field);

function valuesOf(doc: Doc, field: string): unknown[] {
  const v = doc[fieldOf(field)];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function evaluateClause(clause: Record<string, any>, doc: Doc): boolean {
  const [kind, body] = Object.entries(clause)[0];
  switch (kind) {
    case 'bool':
      return (
        (body.filter ?? []).every((c: any) => evaluateClause(c, doc)) &&
        (body.must ?? []).every((c: any) => evaluateClause(c, doc)) &&
        !(body.must_not ?? []).some((c: any) => evaluateClause(c, doc))
      );
    case 'terms': {
      const [field, list] = Object.entries(body)[0] as [string, unknown[]];
      return valuesOf(doc, field).some((v) => list.includes(v));
    }
    case 'term': {
      const [field, value] = Object.entries(body)[0];
      return valuesOf(doc, field).some((v) => v === value);
    }
    case 'exists':
      return valuesOf(doc, body.field).length > 0;
    default:
      throw new Error(`parity evaluator does not model "${kind}"`);
  }
}

function evaluateSearch(request: Record<string, any>) {
  const matched = FIXTURE.filter((d) => evaluateClause(request.query, d));
  const sorts = request.sort as Record<
    string,
    { order: string; missing?: string }
  >[];
  matched.sort((a, b) => {
    for (const spec of sorts) {
      const [field, { order, missing }] = Object.entries(spec)[0];
      const av = valuesOf(a, field)[0] as string | undefined;
      const bv = valuesOf(b, field)[0] as string | undefined;
      const missingFirst = (missing ?? '_last') === '_first';
      let cmp: number;
      if (av === undefined || bv === undefined) {
        cmp = av === bv ? 0 : (av === undefined) === missingFirst ? -1 : 1;
      } else {
        cmp = byteCompare(av, bv) * (order === 'desc' ? -1 : 1);
      }
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  const total =
    request.track_total_hits === true
      ? matched.length
      : Math.min(matched.length, 3);
  return {
    hits: {
      total: { value: total, relation: 'eq' },
      hits: matched
        .slice(request.from, request.from + request.size)
        .map(({ _id, ...source }) => ({ _id, _source: source })),
    },
  };
}

function evaluateAggregations(request: Record<string, any>) {
  const matched = FIXTURE.filter((d) => evaluateClause(request.query, d));
  const aggregations: Record<string, unknown> = {};
  for (const [name, agg] of Object.entries<any>(request.aggs)) {
    const { size, sources, after } = agg.composite;
    const field = sources[0].key.terms.field as string;
    const counts = new Map<string, number>();
    for (const doc of matched) {
      for (const v of new Set(valuesOf(doc, field).map(String))) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    const keys = [...counts.keys()]
      .sort(byteCompare)
      .filter((k) => !after || byteCompare(k, after.key) > 0)
      .slice(0, size);
    aggregations[name] = {
      buckets: keys.map((k) => ({ key: { key: k }, doc_count: counts.get(k) })),
      ...(keys.length ? { after_key: { key: keys[keys.length - 1] } } : {}),
    };
  }
  return { aggregations };
}

// --- The cases -------------------------------------------------------------

const WRITER_SETS = [[A], [B], [C], [A, B], [A, B, C], []];
const CODE_SETS = [
  [],
  ['BD-1800'],
  ['BD-18'],
  ['BD'],
  ['BD-1800', 'LR'],
  ['Serbo-Croatian'],
  ['XX-1'],
];
const STATUS_SETS = [[], ['active'], ['inactive'], ['active', 'closed'], ['']];
const PAGES = [
  { offset: 0, limit: 50 },
  { offset: 0, limit: 2 },
  { offset: 2, limit: 3 },
  { offset: 100, limit: 5 },
];

describe('services search parity with the Mongo record source', () => {
  const search = jest.fn(async (request: Record<string, any>) =>
    request.aggs ? evaluateAggregations(request) : evaluateSearch(request),
  );
  const service = new ServiceSearchService({
    search,
  } as unknown as ElasticsearchService);

  const listCases = WRITER_SETS.flatMap((writers) =>
    CODE_SETS.flatMap((codes) =>
      STATUS_SETS.flatMap((statuses) =>
        PAGES.map((page) => ({ writers, codes, statuses, ...page })),
      ),
    ),
  );

  it('the fixture exercises every clause (guard against a vacuous pass)', () => {
    const everything = mongoListRecords({
      writers: [A, B, C],
      codes: [],
      statuses: [],
      offset: 0,
      limit: 100,
    });
    // 13 documents; the borrowed copy and two without a usable serviceId drop.
    expect(everything.total).toBe(10);
    expect(everything.ids.slice(0, 5)).toEqual([
      't:s4',
      'w:u1',
      't:s7',
      't:s0',
      't:s1',
    ]);
  });

  it.each(listCases)(
    'lists the same page and total: writers=$writers codes=$codes statuses=$statuses offset=$offset limit=$limit',
    async ({ writers, codes, statuses, offset, limit }) => {
      const expected = mongoListRecords({
        writers,
        codes,
        statuses,
        offset,
        limit,
      });
      const actual = await service.search({
        resourceWriterIds: writers,
        filter: { taxonomyCodes: codes, statuses },
        offset,
        limit,
      });
      expect({
        ids: actual.items.map((i) => i.id),
        total: actual.total,
      }).toEqual(expected);
    },
  );

  it.each(WRITER_SETS.map((writers) => ({ writers })))(
    'returns the same facet options and counts: writers=$writers',
    async ({ writers }) => {
      await expect(
        service.facets({ resourceWriterIds: writers }),
      ).resolves.toEqual(mongoListFilterOptions(writers));
    },
  );
});

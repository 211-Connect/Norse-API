import { ElasticsearchService } from '@nestjs/elasticsearch';
import { buildAirsTreeFromPathCounts, normalizeAirsCode } from './airs';
import { ServiceSearchService } from './service-search.service';
import { RegionService } from '../../region/internal';

/**
 * Parity with ServiceNet's Mongo record source (`sharing-mongo/src/record-source.ts`)
 * for the same inputs.
 *
 * `mongo*` below restate that adapter's `buildQuery`, `listRecords` sort/skip/limit
 * and `listFilterOptions` aggregations as predicates over a fixture. `evaluate*`
 * run the request this service actually sends to ES over the same fixture, using
 * the ES semantics that matter here: `terms` matches any array element, `exists`
 * is false for a missing field, `missing: '_first'`, keyword order is byte order,
 * `search_after` resumes strictly after the given sort values, the total stops at
 * 10,000 unless `track_total_hits` is true, and a composite bucket counts a
 * document once per distinct value.
 *
 * Pages are walked with the cursor the service returns and compared with Mongo's
 * skip/limit slices of the same ordering.
 *
 * Text search is excluded from parity: it deliberately differs (name regex ->
 * name contains OR multi_match, ordered by score). The evaluator models the
 * `wildcard` half exactly and treats `multi_match` as matching nothing, so the
 * text tests below exercise the contains match alone.
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

const fieldOf = (field: string) =>
  field === 'name.raw' || field === 'name.substring' ? 'name' : field;

function valuesOf(doc: Doc, field: string): unknown[] {
  const v = doc[fieldOf(field)];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** ES wildcard: `*` any run, `?` one character, `\` escapes the next one. */
function wildcardRegex(pattern: string, caseInsensitive: boolean): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, caseInsensitive ? 'is' : 's');
}

function evaluateClause(clause: Record<string, any>, doc: Doc): boolean {
  const [kind, body] = Object.entries(clause)[0];
  switch (kind) {
    case 'bool': {
      const should = (body.should ?? []) as any[];
      const shouldOk =
        should.length === 0 ||
        should.filter((c) => evaluateClause(c, doc)).length >=
          (body.minimum_should_match ?? 1);
      return (
        (body.filter ?? []).every((c: any) => evaluateClause(c, doc)) &&
        (body.must ?? []).every((c: any) => evaluateClause(c, doc)) &&
        !(body.must_not ?? []).some((c: any) => evaluateClause(c, doc)) &&
        shouldOk
      );
    }
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
    case 'wildcard': {
      const [field, spec] = Object.entries<any>(body)[0];
      const re = wildcardRegex(spec.value, spec.case_insensitive === true);
      return valuesOf(doc, field).some((v) => re.test(String(v)));
    }
    case 'multi_match':
      return false;
    default:
      throw new Error(`parity evaluator does not model "${kind}"`);
  }
}

type SortValue = string | number | null;

function sortValuesOf(
  doc: Doc,
  sorts: Record<string, { order: string; missing?: string }>[],
): SortValue[] {
  return sorts.map((spec) => {
    const field = Object.keys(spec)[0];
    if (field === '_score') return 1;
    const v = valuesOf(doc, field)[0];
    return v === undefined ? null : (v as SortValue);
  });
}

function compareSortValues(
  a: SortValue[],
  b: SortValue[],
  sorts: Record<string, { order: string; missing?: string }>[],
): number {
  for (let i = 0; i < sorts.length; i++) {
    const { order, missing } = Object.values(sorts[i])[0];
    const av = a[i];
    const bv = b[i];
    const missingFirst = (missing ?? '_last') === '_first';
    let cmp: number;
    if (av === null || bv === null) {
      cmp = av === bv ? 0 : (av === null) === missingFirst ? -1 : 1;
    } else if (typeof av === 'number' && typeof bv === 'number') {
      cmp = (av - bv) * (order === 'desc' ? -1 : 1);
    } else {
      cmp = byteCompare(String(av), String(bv)) * (order === 'desc' ? -1 : 1);
    }
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function evaluateSearch(docs: Doc[], request: Record<string, any>) {
  const sorts = request.sort as Record<
    string,
    { order: string; missing?: string }
  >[];
  const matched = docs
    .filter((d) => evaluateClause(request.query, d))
    .map((d) => ({ d, sort: sortValuesOf(d, sorts) }))
    .sort((a, b) => compareSortValues(a.sort, b.sort, sorts));
  const after = request.search_after as SortValue[] | undefined;
  const remaining = after
    ? matched.filter((m) => compareSortValues(m.sort, after, sorts) > 0)
    : matched;
  const from = request.from ?? 0;
  const total =
    request.track_total_hits === true
      ? matched.length
      : Math.min(matched.length, 10_000);
  return {
    hits: {
      total: { value: total, relation: 'eq' },
      hits: remaining.slice(from, from + request.size).map(({ d, sort }) => {
        const { _id, ...source } = d;
        return { _id, _source: source, sort };
      }),
    },
  };
}

function evaluateAggregations(docs: Doc[], request: Record<string, any>) {
  const matched = docs.filter((d) => evaluateClause(request.query, d));
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

function serviceOver(docs: Doc[]) {
  const search = jest.fn(async (request: Record<string, any>) =>
    request.aggs
      ? evaluateAggregations(docs, request)
      : evaluateSearch(docs, request),
  );
  return {
    search,
    service: new ServiceSearchService(
      { search } as unknown as ElasticsearchService,
      { assertExist: async () => undefined } as unknown as RegionService,
    ),
  };
}

/** Every page of a query, following nextCursor; fails if paging never ends. */
async function walk(
  service: ServiceSearchService,
  request: Omit<Parameters<ServiceSearchService['search']>[0], 'cursor'>,
  maxPages = 20,
) {
  const pages: { ids: string[]; total: number }[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < maxPages; guard++) {
    const page = await service.search({ ...request, cursor });
    pages.push({ ids: page.items.map((i) => i.id), total: page.total });
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
  }
  throw new Error(`paging did not end within ${maxPages} pages`);
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
const LIMITS = [50, 1, 2, 3];

describe('services search parity with the Mongo record source', () => {
  const { service } = serviceOver(FIXTURE);

  const listCases = WRITER_SETS.flatMap((writers) =>
    CODE_SETS.flatMap((codes) =>
      STATUS_SETS.flatMap((statuses) =>
        LIMITS.map((limit) => ({ writers, codes, statuses, limit })),
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
    'walks the same pages and total: writers=$writers codes=$codes statuses=$statuses limit=$limit',
    async ({ writers, codes, statuses, limit }) => {
      const pages = await walk(service, {
        resourceWriterIds: writers,
        filter: { taxonomyCodes: codes, statuses },
        limit,
      });
      const all = mongoListRecords({
        writers,
        codes,
        statuses,
        offset: 0,
        limit: 1_000,
      });
      const expectedPages = Math.max(1, Math.ceil(all.total / limit));
      expect(pages).toHaveLength(expectedPages);
      pages.forEach((page, i) => {
        expect(page).toEqual(
          mongoListRecords({
            writers,
            codes,
            statuses,
            offset: i * limit,
            limit,
          }),
        );
      });
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

describe('paging beyond the ES result window', () => {
  const COUNT = 10_050;
  const docs: Doc[] = Array.from({ length: COUNT }, (_, i) => ({
    _id: `t:s${i}`,
    serviceId: `s${String(i).padStart(5, '0')}`,
    resourceWriterId: A,
    // 100 distinct names, so every page boundary lands inside a name tie.
    name: `Service ${String(i % 100).padStart(3, '0')}`,
    status: 'active',
  }));
  const { service, search } = serviceOver(docs);

  it('reaches every record exactly once, with an exact total and a null cursor at the end', async () => {
    const pages = await walk(
      service,
      { resourceWriterIds: [A], limit: 200 },
      60,
    );
    const ids = pages.flatMap((p) => p.ids);
    expect(ids).toHaveLength(COUNT);
    expect(new Set(ids).size).toBe(COUNT);
    expect(pages.every((p) => p.total === COUNT)).toBe(true);
    expect(pages).toHaveLength(Math.ceil(COUNT / 200));
    expect(
      search.mock.calls.every(([request]) => request.from === undefined),
    ).toBe(true);
  });

  it('pages a text search by score with the serviceId tie-breaker', async () => {
    const pages = await walk(
      service,
      {
        resourceWriterIds: [A],
        text: 'service 00',
        limit: 7,
      },
      160,
    );
    const ids = pages.flatMap((p) => p.ids);
    // "Service 000" .. "Service 009", ~101 records each.
    const expected = docs.filter((d) =>
      /service 00/i.test(d.name as string),
    ).length;
    expect(new Set(ids).size).toBe(expected);
    expect(ids).toHaveLength(expected);
  });
});

describe('text: name contains match (the deliberate change)', () => {
  const docs: Doc[] = [
    { _id: 't:1', serviceId: '1', resourceWriterId: A, name: 'Food Bank' },
    { _id: 't:2', serviceId: '2', resourceWriterId: A, name: 'Fo*d Pantry' },
    { _id: 't:3', serviceId: '3', resourceWriterId: A, name: 'Fo?d Shelf' },
    { _id: 't:4', serviceId: '4', resourceWriterId: A, name: 'C:\\Temp Help' },
    { _id: 't:5', serviceId: '5', resourceWriterId: A, name: 'Shelter' },
  ];
  const { service } = serviceOver(docs);
  const ids = async (text: string) =>
    (await service.search({ resourceWriterIds: [A], text })).items.map(
      (i) => i.id,
    );

  it('finds a mid-word substring: "ood" finds "Food"', async () => {
    expect(await ids('ood')).toEqual(['t:1']);
  });

  it('matches case-insensitively: "FOOD" finds "Food"', async () => {
    expect(await ids('FOOD')).toEqual(['t:1']);
  });

  it('treats * and ? in the text as literals', async () => {
    expect(await ids('fo*d')).toEqual(['t:2']);
    expect(await ids('fo?d')).toEqual(['t:3']);
  });

  it('treats a backslash in the text as a literal', async () => {
    expect(await ids('c:\\temp')).toEqual(['t:4']);
  });
});

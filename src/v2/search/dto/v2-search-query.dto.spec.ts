import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import { V2SearchQueryDto } from './v2-search-query.dto';
import { TIER1_CODES } from '../../rules/sune';
import {
  MAX_QUERY_LENGTH,
  QUERY_TOO_LONG_MESSAGE,
} from 'src/search/internal/query-log';

const parse = (raw: Record<string, unknown>) => {
  const dto = plainToInstance(V2SearchQueryDto, raw);
  const errors = validateSync(dto, { whitelist: true });
  return { dto, errors, props: errors.map((e) => e.property) };
};

describe('V2SearchQueryDto', () => {
  it('applies defaults: clarify auto, v1 paging and sort defaults, no needs', () => {
    const { dto, errors } = parse({ query: 'rent' });
    expect(errors).toEqual([]);
    expect(dto.clarify).toBe('auto');
    expect(dto.needs).toBeUndefined();
    expect(dto.passed_needs).toBeUndefined();
    expect(dto.urgency).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(25);
    expect(dto.sort).toBe('relevance');
  });

  it('limit takes 1 to 300 on v2 (v1 keeps 25 to 300)', () => {
    for (const limit of ['1', '10', '24', '300']) {
      expect(parse({ query: 'rent', limit }).errors).toEqual([]);
    }
    for (const limit of ['0', '-1', '301', 'abc', '1.5']) {
      expect(parse({ query: 'rent', limit }).props).toContain('limit');
    }
    expect(parse({ query: 'rent', limit: '10' }).dto.limit).toBe(10);
    const v1 = validateSync(
      plainToInstance(SearchResourcesQueryDto, { limit: '10' }),
    );
    expect(v1.map((e) => e.property)).toContain('limit');
  });

  it('relevance_cutoff defaults to off; the caller can send on', () => {
    expect(parse({ query: 'rent' }).dto.relevance_cutoff).toBe('off');
    expect(
      parse({ query: 'rent', relevance_cutoff: 'on' }).dto.relevance_cutoff,
    ).toBe('on');
    expect(parse({ query: 'rent', relevance_cutoff: 'bogus' }).props).toContain(
      'relevance_cutoff',
    );
  });

  it('does not carry query_type', () => {
    const { dto } = parse({ query: 'rent', query_type: 'text' });
    expect('query_type' in dto && dto['query_type' as never]).toBeFalsy();
  });

  it('reuses v1 validation (page window)', () => {
    expect(parse({ page: '401', limit: '25' }).props).toContain('page');
  });

  it.each(['U-0', 'U-1', 'U-2', 'U-3', 'U-4', 'U-X'])(
    'accepts urgency %s',
    (urgency) => {
      expect(parse({ urgency }).errors).toEqual([]);
    },
  );

  it.each(['U-5', 'u-1', 'now', '', 'U-1,U-2'])(
    'rejects urgency %p',
    (urgency) => {
      expect(parse({ urgency }).props).toContain('urgency');
    },
  );

  it('rejects an unknown need code', () => {
    expect(parse({ needs: 'N-HOU,N-NOPE' }).props).toContain('needs');
    expect(parse({ passed_needs: ['N-NOPE'] }).props).toContain('passed_needs');
  });

  it('names each unknown need code in the reason (Lucas 2026-11-12, answer 7)', () => {
    const r = parse({ needs: 'N-HOU,N-NOPE,N-ZZZ-99' });
    const reason = JSON.stringify(r.errors[0].constraints);
    expect(reason).toContain('unknown need code(s): N-NOPE, N-ZZZ-99');
    expect(reason).not.toContain('N-HOU,');
    expect(reason).not.toContain('N-X');
  });

  it('names an unknown passed_needs code in the reason', () => {
    const r = parse({ passed_needs: ['N-NOPE'] });
    expect(JSON.stringify(r.errors[0].constraints)).toContain(
      'unknown need code(s): N-NOPE',
    );
  });

  it('rejects N-X in needs with a message naming Tier 1 and Tier 2 (ISS-2499)', () => {
    const r = parse({ needs: 'N-X' });
    expect(r.props).toContain('needs');
    expect(JSON.stringify(r.errors[0].constraints)).toContain(
      'Tier 1 or Tier 2',
    );
    expect(parse({ needs: 'N-HOU,N-X' }).props).toContain('needs');
  });

  it('rejects N-X in passed_needs and names it (ADR 0039 Decision 57)', () => {
    const r = parse({ passed_needs: 'N-HOU,N-X' });
    expect(r.props).toContain('passed_needs');
    expect(JSON.stringify(r.errors[0].constraints)).toContain('N-X');
  });

  it('still accepts urgency=U-X (counts as absent in the engine)', () => {
    expect(parse({ urgency: 'U-X' }).errors).toEqual([]);
  });

  it('parses comma-separated and repeated forms to the same array', () => {
    const comma = parse({ needs: 'N-HOU, N-FOD-01' }).dto.needs;
    const repeated = parse({ needs: ['N-HOU', 'N-FOD-01'] }).dto.needs;
    expect(comma).toEqual(['N-HOU', 'N-FOD-01']);
    expect(repeated).toEqual(comma);
    const mixed = parse({ passed_needs: ['N-HOU,N-FOD-01', 'N-MON'] });
    expect(mixed.errors).toEqual([]);
    expect(mixed.dto.passed_needs).toEqual(['N-HOU', 'N-FOD-01', 'N-MON']);
  });

  it('drops empty segments and duplicates', () => {
    expect(parse({ needs: 'N-HOU,,N-HOU,' }).dto.needs).toEqual(['N-HOU']);
  });

  it('rejects an unknown clarify value', () => {
    expect(parse({ clarify: 'always' }).props).toContain('clarify');
    expect(parse({ clarify: 'never' }).errors).toEqual([]);
  });

  // ISS-2612: `taxonomy` comes from the v1 DTO unchanged (comma list or array).
  it('keeps the v1 taxonomy parameter: comma list and repeated values', () => {
    const comma = parse({ taxonomy: 'BD-1800.2000, BD-1800.1500' });
    expect(comma.errors).toEqual([]);
    expect(comma.dto.taxonomy).toEqual(['BD-1800.2000', 'BD-1800.1500']);
    const repeated = parse({ taxonomy: ['BD-1800.2000', 'BD-1800.2000'] });
    expect(repeated.dto.taxonomy).toEqual(['BD-1800.2000']);
    expect(parse({}).dto.taxonomy).toEqual([]);
  });

  it('classify is not a request parameter (always on, Lucas 2026-11-18)', () => {
    expect(parse({ classify: 'off' }).dto).not.toHaveProperty('classify');
    expect(parse({ query: 'rent' }).dto).not.toHaveProperty('classify');
  });

  // Break run 2026-11-14 (HANDOFF-ASSETS/v2-search--eval-data/break-v2-2026-11-14):
  // `query[]=food&query[]=rent` and `query[OR][]=...` reached the search as the
  // text "food,rent" and "[object Object]". The v2 contract types query as a string.
  it('rejects a query that is not a string (array or AND/OR object) with a reason', () => {
    for (const bad of [['food', 'rent'], { OR: ['food', 'rent'] }, 5]) {
      const r = parse({ query: bad });
      expect(r.props).toContain('query');
      expect(JSON.stringify(r.errors[0].constraints)).toContain(
        'query must be a string',
      );
    }
  });

  it('accepts a plain string query and the empty default', () => {
    expect(parse({ query: 'food pantry' }).errors).toEqual([]);
    expect(parse({}).errors).toEqual([]);
    expect(parse({}).dto.query).toBe('');
  });

  // One rule for v1 and v2: the same limit and the same 400 message, so the
  // printable directory recognises a v2 rejection too (David, PR #279 review).
  it('caps query at MAX_QUERY_LENGTH with the v1 message (David, PR #278 review)', () => {
    expect(MAX_QUERY_LENGTH).toBe(500);
    expect(parse({ query: 'a'.repeat(MAX_QUERY_LENGTH) }).errors).toEqual([]);
    const r = parse({ query: 'a'.repeat(MAX_QUERY_LENGTH + 1) });
    expect(r.props).toContain('query');
    expect(Object.values(r.errors[0].constraints ?? {})).toContain(
      QUERY_TOO_LONG_MESSAGE,
    );
  });

  it('counts an emoji as 2 characters, as Elasticsearch does', () => {
    expect(parse({ query: '😀'.repeat(250) }).errors).toEqual([]);
    expect(parse({ query: '😀'.repeat(251) }).props).toContain('query');
  });

  // Break run 2026-11-14: coords=Infinity,0 was a 500 (Elasticsearch geo error);
  // coords=200,100 searched with an impossible point; coords=abc,def was dropped.
  it.each([
    'Infinity,0',
    '200,100',
    '-87.6,95',
    'abc,def',
    '1,2,3',
    'NaN,NaN',
    '-87.6',
  ])('rejects coords %p with a 400 reason', (coords) => {
    const r = parse({ coords });
    expect(r.props).toContain('coords');
    expect(JSON.stringify(r.errors[0].constraints)).toContain(
      'coords must be longitude,latitude',
    );
  });

  it('accepts coords in range and keeps the v1 [lon, lat] shape', () => {
    const r = parse({ coords: '-87.6298,41.8781' });
    expect(r.errors).toEqual([]);
    expect(r.dto.coords).toEqual([-87.6298, 41.8781]);
    expect(parse({ coords: '180,-90' }).errors).toEqual([]);
    expect(parse({}).dto.coords).toBeUndefined();
  });
});

describe('V2SearchQueryDto asked', () => {
  it('parses a comma list and repeats into one list', () => {
    expect(parse({ asked: 'start,area:N-HOU' }).dto.asked).toEqual([
      'start',
      'area:N-HOU',
    ]);
    expect(parse({ asked: ['start', 'start', 'x'] }).dto.asked).toEqual([
      'start',
      'x',
    ]);
  });
  it('a bad value never fails the search: what is not a question id is left out', () => {
    for (const asked of [
      'has space',
      '<script>',
      'x'.repeat(41),
      { a: 'start' },
      [{ a: 'start' }],
      ['', ','],
    ]) {
      const { dto, props } = parse({ asked } as never);
      expect(props).not.toContain('asked');
      expect(dto.asked ?? []).toEqual([]);
    }
    expect(parse({ asked: 'start,has space,spread' }).dto.asked).toEqual([
      'start',
      'spread',
    ]);
  });
  it('reads at most 20 ids; more is not a 400', () => {
    const { dto, props } = parse({
      asked: Array.from({ length: 25 }, (_, i) => `q${i}`).join(','),
    });
    expect(props).not.toContain('asked');
    expect(dto.asked).toHaveLength(20);
  });
  it('missing or empty: no cap', () => {
    expect(parse({}).dto.asked).toBeUndefined();
    expect(parse({ asked: '' }).dto.asked).toEqual([]);
  });
  it('every id the engine sends is a question id', () => {
    const ids = ['emergency', 'urgency_today', 'urgency_time', 'start'].concat(
      'spread',
      'no_match',
      TIER1_CODES.map((c) => `area:${c}`).slice(0, 14),
    );
    expect(parse({ asked: ids.join(',') }).dto.asked).toEqual(ids);
  });
});

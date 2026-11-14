import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { V2_QUERY_MAX_LENGTH, V2SearchQueryDto } from './v2-search-query.dto';

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

  it('classify accepts only off; absent stays undefined; any other value is a 400', () => {
    expect(parse({ classify: 'off' }).errors).toEqual([]);
    expect(parse({ classify: 'off' }).dto.classify).toBe('off');
    expect(parse({ query: 'rent' }).dto.classify).toBeUndefined();
    for (const bad of ['on', 'auto', 'OFF', '', 'false'])
      expect(parse({ classify: bad }).props).toContain('classify');
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

  it('caps query at V2_QUERY_MAX_LENGTH characters (David, PR #278 review)', () => {
    expect(V2_QUERY_MAX_LENGTH).toBe(1000);
    expect(parse({ query: 'a'.repeat(V2_QUERY_MAX_LENGTH) }).errors).toEqual(
      [],
    );
    const r = parse({ query: 'a'.repeat(V2_QUERY_MAX_LENGTH + 1) });
    expect(r.props).toContain('query');
    expect(JSON.stringify(r.errors[0].constraints)).toContain('1000');
  });

  it('counts an emoji as 2 characters, as Elasticsearch does', () => {
    expect(parse({ query: '😀'.repeat(500) }).errors).toEqual([]);
    expect(parse({ query: '😀'.repeat(501) }).props).toContain('query');
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

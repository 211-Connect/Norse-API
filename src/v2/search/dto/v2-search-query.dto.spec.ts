import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { V2SearchQueryDto } from './v2-search-query.dto';

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

  it('accepts N-X, as the rules engine accepts it in needs', () => {
    expect(parse({ needs: 'N-X' }).errors).toEqual([]);
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
});

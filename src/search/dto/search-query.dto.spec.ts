import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchQueryApiDto } from './search-query.api.dto';
import { SearchResourcesQueryDto } from './search-query.dto';
import { ValidationError } from 'class-validator';

const pageError = <T extends object>(
  raw: Record<string, unknown>,
  dtoClass: new () => T,
): ValidationError | undefined =>
  validateSync(plainToInstance(dtoClass, raw), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).find((error) => error.property === 'page');

describe('SearchResourcesQueryDto pagination window', () => {
  it('rejects the overflow page that crashed ES (page=998823722, limit=25)', () => {
    // Regression for the production 500: x_content_parse_exception
    // because (page - 1) * limit exceeded Elasticsearch's int32 `from` range.
    const error = pageError(
      { query: 'food', page: '998823722', limit: '25' },
      SearchResourcesQueryDto,
    );

    expect(error).toBeDefined();
    expect(error?.constraints).toHaveProperty(
      'isWithinMaxResultWindow',
      expect.stringContaining('maximum result window'),
    );
  });

  it('accepts the deepest reachable page (page * limit == 10000)', () => {
    expect(
      pageError(
        { query: 'food', page: 400, limit: 25 },
        SearchResourcesQueryDto,
      ),
    ).toBeUndefined();
    expect(
      pageError(
        { query: 'food', page: 33, limit: 300 },
        SearchResourcesQueryDto,
      ),
    ).toBeUndefined();
  });

  it('rejects page * limit beyond the window', () => {
    expect(
      pageError(
        { query: 'food', page: 401, limit: 25 },
        SearchResourcesQueryDto,
      ),
    ).toBeDefined();
    expect(
      pageError(
        { query: 'food', page: 34, limit: 300 },
        SearchResourcesQueryDto,
      ),
    ).toBeDefined();
  });

  it('applies the default limit of 25 when limit is omitted', () => {
    expect(
      pageError({ query: 'food', page: 400 }, SearchResourcesQueryDto),
    ).toBeUndefined();
    expect(
      pageError({ query: 'food', page: 401 }, SearchResourcesQueryDto),
    ).toBeDefined();
  });
});

describe('SearchQueryApiDto pagination window', () => {
  it('rejects an overflow page', () => {
    expect(
      pageError({ query: 'housing', page: 998823722 }, SearchQueryApiDto),
    ).toBeDefined();
  });

  it('accepts a page within the window', () => {
    expect(
      pageError({ query: 'housing', page: 400, limit: 25 }, SearchQueryApiDto),
    ).toBeUndefined();
  });
});

import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchOrganizationQueryDto } from './search-organization-query.dto';

const validatePage = (raw: Record<string, unknown>) =>
  validateSync(plainToInstance(SearchOrganizationQueryDto, raw), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).find((error) => error.property === 'page');

describe('SearchOrganizationQueryDto pagination window', () => {
  it('rejects an overflow page that would overflow the ES `from` offset', () => {
    expect(
      validatePage({ query: 'red cross', page: 998823722, limit: 10 }),
    ).toBeDefined();
  });

  it('accepts the deepest reachable page (page * limit == 10000)', () => {
    expect(
      validatePage({ query: 'red cross', page: 1000, limit: 10 }),
    ).toBeUndefined();
  });

  it('rejects page * limit beyond the window', () => {
    expect(
      validatePage({ query: 'red cross', page: 1001, limit: 10 }),
    ).toBeDefined();
    expect(
      validatePage({ query: 'red cross', page: 201, limit: 50 }),
    ).toBeDefined();
  });
});

// `@arcjet/nest` ships ESM only; the guard decorator only needs the token.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import { readFileSync } from 'fs';
import {
  V2_SEARCH_OPENAPI_PATH,
  createV2SearchOpenApi,
  serializeOpenApi,
} from './v2-search-openapi';

describe('v2 search OpenAPI', () => {
  it('holds the v2 search routes, their parameters and their errors', async () => {
    const doc = await createV2SearchOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual(['/search', '/v2/search']);
    for (const path of ['/v2/search', '/search']) {
      expect(Object.keys(doc.paths[path]).sort()).toEqual(['get', 'post']);
    }
    const get = doc.paths['/v2/search'].get;
    expect(Object.keys(get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '404']),
    );
    const names = get.parameters.map(
      (p: unknown) => (p as { name: string }).name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'needs',
        'passed_needs',
        'urgency',
        'clarify',
        'x-tenant-id',
        'accept-language',
      ]),
    );
    // classify is always on: no request parameter (Lucas 2026-11-18).
    expect(names).not.toContain('classify');
    expect(names).not.toContain('relevance_cutoff_fraction');
    const cutoff = get.parameters.find(
      (p: unknown) => (p as { name: string }).name === 'relevance_cutoff',
    ) as { description: string };
    expect(cutoff.description).toContain('dynamic ladder only');
    expect(cutoff.description).not.toContain('query_type');
    expect(doc.info.description).toContain('enableV2Api');
    expect(get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'limit',
          schema: expect.objectContaining({
            type: 'integer',
            minimum: 25,
            maximum: 300,
          }),
        }),
        expect.objectContaining({ name: 'x-tenant-id', required: true }),
        expect.objectContaining({ name: 'accept-language', required: true }),
      ]),
    );
  });

  it('matches the committed file docs/openapi/v2-search.openapi.json', async () => {
    const doc = await createV2SearchOpenApi();
    expect(readFileSync(V2_SEARCH_OPENAPI_PATH, 'utf8')).toBe(
      serializeOpenApi(doc),
    );
  });
});

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
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/v2/search',
      '/v2/search/pins',
    ]);
    expect(Object.keys(doc.paths['/v2/search']).sort()).toEqual([
      'get',
      'post',
    ]);
    expect(Object.keys(doc.paths['/v2/search/pins'])).toEqual(['get']);
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
        'tenant_id',
        'locale',
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
            minimum: 1,
            maximum: 300,
          }),
        }),
        expect.objectContaining({ name: 'tenant_id', required: true }),
        expect.objectContaining({ name: 'locale', required: true }),
      ]),
    );
  });

  it('states the query cap, the strict locale and the nullable answer option', async () => {
    const doc = await createV2SearchOpenApi();
    const get = doc.paths['/v2/search'].get;
    const param = (name: string) =>
      get.parameters.find((p: { name: string }) => p.name === name);
    expect(param('query').schema.maxLength).toBe(500);
    expect(param('locale').required).toBe(true);
    expect(param('locale').description).toContain('Exactly one');
    expect(get.responses['400'].description).toContain('500 characters');
    const option = doc.components.schemas.V2QuestionOptionDto.properties;
    expect(option.parameter.nullable).toBe(true);
    expect(option.value.nullable).toBe(true);
  });

  it('matches the committed file docs/openapi/v2-search.openapi.json', async () => {
    const doc = await createV2SearchOpenApi();
    expect(readFileSync(V2_SEARCH_OPENAPI_PATH, 'utf8')).toBe(
      serializeOpenApi(doc),
    );
  });
});

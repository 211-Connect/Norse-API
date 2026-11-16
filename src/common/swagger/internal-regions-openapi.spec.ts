import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { createInternalRegionsOpenApi } from './internal-regions-openapi';

describe('internal Regions OpenAPI', () => {
  it('describes Place operations, authentication, paging and response schemas', async () => {
    const doc = await createInternalRegionsOpenApi();
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.components?.securitySchemes?.['x-internal-api-key']).toEqual({
      type: 'apiKey',
      name: 'x-internal-api-key',
      in: 'header',
    });
    const list = doc.paths['/internal/regions/places']?.get;
    const detail = doc.paths['/internal/regions/places/{slug}']?.get;
    expect(list).toBeDefined();
    expect(detail).toBeDefined();
    for (const operation of [list, detail]) {
      expect(operation.security).toContainEqual({ 'x-internal-api-key': [] });
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '502', '503']),
      );
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'x-api-version',
            in: 'header',
            required: false,
          }),
        ]),
      );
    }
    expect(detail.responses).toHaveProperty('404');
    expect(list.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'state',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ pattern: '^[A-Z]{2}$' }),
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: expect.objectContaining({
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 25,
          }),
        }),
        expect.objectContaining({
          name: 'cursor',
          in: 'query',
          required: false,
        }),
      ]),
    );
    expect(detail.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'slug', in: 'path', required: true }),
      ]),
    );
    const schemas = doc.components.schemas as Record<string, SchemaObject>;
    expect(schemas.PlaceListDto.required).toEqual(
      expect.arrayContaining(['items', 'next_cursor']),
    );
    expect(schemas.PlaceListDto.properties.next_cursor).toMatchObject({
      nullable: true,
    });
    expect(schemas.PlaceDetailDto.required).toEqual(
      expect.arrayContaining([
        'id',
        'type',
        'name',
        'state',
        'fips',
        'slug',
        'lsad',
        'place_type',
        'centroid',
        'bbox',
        'geometry',
      ]),
    );
    expect(schemas.PlaceDetailDto.properties.bbox).toMatchObject({
      type: 'array',
      minItems: 4,
      maxItems: 4,
    });
    expect(schemas.PlaceDetailDto.properties.geometry).toMatchObject({
      oneOf: [
        { properties: { type: { enum: ['Polygon'] } } },
        { properties: { type: { enum: ['MultiPolygon'] } } },
      ],
    });

    // Every local schema reference in the generated contract must resolve.
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      for (const [key, nested] of Object.entries(value)) {
        if (
          key === '$ref' &&
          typeof nested === 'string' &&
          nested.startsWith('#/components/schemas/')
        ) {
          expect(
            schemas[nested.slice('#/components/schemas/'.length)],
          ).toBeDefined();
        } else visit(nested);
      }
    };
    visit(doc);
  });
});

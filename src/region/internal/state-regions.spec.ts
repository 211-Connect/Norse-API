import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadGatewayException } from '@nestjs/common';
import { RegionService } from './region.service';
import { StateRegionsQueryDto } from './dto';
import { REGIONS_INDEX } from './region.constants';

const PIERCE = {
  id: 'county:53053',
  type: 'county',
  name: 'Pierce County, WA',
  state: 'WA',
};
const KING = {
  id: 'county:53033',
  type: 'county',
  name: 'King County, WA',
  state: 'WA',
};
const TACOMA = {
  id: 'place:5370000',
  type: 'place',
  name: 'Tacoma',
  state: 'WA',
  slug: 'tacoma-wa',
  place_type: 'city',
};
const SEATTLE = {
  id: 'place:5363000',
  type: 'place',
  name: 'Seattle',
  state: 'WA',
  slug: 'seattle-wa',
  place_type: 'city',
};
const NOWHERE = {
  id: 'place:5399999',
  type: 'place',
  name: 'Nowhere',
  state: 'WA',
  slug: 'nowhere-wa',
  place_type: 'cdp',
};

const hits = (...sources: object[]) => ({
  hits: { hits: sources.map((s) => ({ _source: s })) },
});

/** The county id an `indexed_shape` request filters on, if any. */
const countyOf = (request: any): string | undefined =>
  request.query.bool.filter.find((f: any) => f.geo_shape)?.geo_shape.centroid
    .indexed_shape.id;

describe('RegionService.listByState', () => {
  const search = jest.fn();
  const elasticsearch = { search } as unknown as ElasticsearchService;
  let service: RegionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RegionService(elasticsearch);
    search.mockImplementation(async (request: any) => {
      const county = countyOf(request);
      if (county === PIERCE.id) return hits({ id: TACOMA.id });
      if (county === KING.id) return hits({ id: SEATTLE.id });
      return hits(PIERCE, TACOMA, KING, SEATTLE, NOWHERE);
    });
  });

  it('lists counties and places sorted by name, each place with its county', async () => {
    const result = await service.listByState({ state: 'WA' });

    expect(result.items).toEqual([
      { id: KING.id, type: 'county', name: KING.name, state: 'WA' },
      { ...NOWHERE, county_id: null },
      { id: PIERCE.id, type: 'county', name: PIERCE.name, state: 'WA' },
      { ...SEATTLE, county_id: KING.id },
      { ...TACOMA, county_id: PIERCE.id },
    ]);
  });

  it('asks for the state, both types and no geometry', async () => {
    await service.listByState({ state: 'WA' });

    const [list] = search.mock.calls[0];
    expect(list.index).toBe(REGIONS_INDEX);
    expect(list._source).not.toContain('geometry');
    expect(list.query.bool.filter).toEqual([
      { terms: { type: ['county', 'place'] } },
      { term: { state: 'WA' } },
    ]);
  });

  it('finds places within each county by centroid', async () => {
    await service.listByState({ state: 'WA' });

    const perCounty = search.mock.calls.map(([r]) => r).filter(countyOf);
    expect(perCounty.map(countyOf).sort()).toEqual([KING.id, PIERCE.id]);
    expect(perCounty[0].query.bool.filter).toEqual(
      expect.arrayContaining([
        { term: { type: 'place' } },
        { term: { state: 'WA' } },
      ]),
    );
    expect(perCounty[0].query.bool.filter[2].geo_shape.centroid.relation).toBe(
      'within',
    );
  });

  it('lists only counties, without per-county searches, when asked', async () => {
    search.mockResolvedValueOnce(hits(PIERCE, KING));

    const result = await service.listByState({
      state: 'WA',
      types: ['county'],
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].query.bool.filter[0]).toEqual({
      terms: { type: ['county'] },
    });
    expect(result.items.map((i) => i.id)).toEqual([KING.id, PIERCE.id]);
  });

  it('lists only places, still assigning counties', async () => {
    const result = await service.listByState({
      state: 'WA',
      types: ['place'],
    });

    expect(result.items.every((i) => i.type === 'place')).toBe(true);
    expect(result.items.find((i) => i.id === TACOMA.id)?.county_id).toBe(
      PIERCE.id,
    );
  });

  it('maps an Elasticsearch failure to 502', async () => {
    search.mockRejectedValueOnce(
      new errors.ResponseError({
        statusCode: 500,
        body: {},
        warnings: null,
        meta: {} as any,
      }),
    );

    await expect(service.listByState({ state: 'WA' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

describe('StateRegionsQueryDto', () => {
  const check = (query: object) =>
    validate(plainToInstance(StateRegionsQueryDto, query));

  it('accepts a lower-case state and a comma list of types', async () => {
    const dto = plainToInstance(StateRegionsQueryDto, {
      state: 'wa',
      types: 'county, place',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.state).toBe('WA');
    expect(dto.types).toEqual(['county', 'place']);
  });

  it('rejects a missing or malformed state', async () => {
    expect(await check({})).not.toEqual([]);
    expect(await check({ state: 'WAS' })).not.toEqual([]);
  });

  it('rejects ZIP and state types', async () => {
    expect(await check({ state: 'WA', types: 'zip' })).not.toEqual([]);
    expect(await check({ state: 'WA', types: 'state' })).not.toEqual([]);
  });
});

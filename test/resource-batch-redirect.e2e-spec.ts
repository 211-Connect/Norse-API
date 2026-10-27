import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { FavoriteListService } from 'src/favorite-list/favorite-list.service';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { Resource } from 'src/common/schemas/resource.schema';
import { ResourceService } from 'src/resource/resource.service';
import { HeadersDto } from 'src/common/dto/headers.dto';

/**
 * Saved favorites and printable directories after a re-key (ISS-2516). Every
 * caller of the batch lookup indexes its result by the id it asked for
 * (`data[requestedId]`), so a re-keyed record must come back under the OLD
 * id, with `redirects` saying where it went. The real ResourceService and
 * FavoriteListService run; only the Mongo models are fakes, and they
 * evaluate the filter they are given, so a lookup that leaves out the tenant
 * matches the other tenant's row and goes red.
 */

const TENANT = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER_TENANT = 'bbbbbbbb-2222-4222-8222-222222222222';
const NEW_ID = 'new-sal-0000';
const KEPT_ID = 'kept-sal-5555';
const OLD_ID = 'old-sal-1111';
const OTHER_TENANTS_OLD_ID = 'old-sal-2222';
const UNKNOWN_ID = 'unknown-sal-3333';
const DANGLING_OLD_ID = 'old-sal-6666';

type Doc = Record<string, unknown>;

const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return (expected.$in as unknown[]).includes(doc[key]);
    }
    return doc[key] === expected;
  });

const resource = (sal: string): Doc => ({
  _id: `mongo-${sal}`,
  serviceAtLocationId: sal,
  tenant_id: TENANT,
  displayName: `Resource ${sal}`,
  translations: [{ locale: 'en', displayName: `Resource ${sal}` }],
});

const resources: Doc[] = [resource(NEW_ID), resource(KEPT_ID)];

const redirects: Doc[] = [
  { _id: OLD_ID, newId: NEW_ID, tenantId: TENANT },
  { _id: OTHER_TENANTS_OLD_ID, newId: NEW_ID, tenantId: OTHER_TENANT },
  // A row whose target no longer resolves: still missing, never invented.
  { _id: DANGLING_OLD_ID, newId: 'gone-sal-7777', tenantId: TENANT },
];

const query = (result: unknown) => {
  const chain = { lean: () => chain, exec: async () => result };
  return chain;
};

const resourceModel = {
  aggregate: (pipeline: Doc[]) =>
    query(resources.filter((doc) => matches(doc, pipeline[0].$match as Doc))),
  find: (filter: Doc) => query(resources.filter((doc) => matches(doc, filter))),
};

const redirectModel = {
  find: (filter: Doc) => query(redirects.filter((doc) => matches(doc, filter))),
  findOne: (filter: Doc) =>
    query(redirects.find((doc) => matches(doc, filter)) ?? null),
  findById: (id: string) =>
    query(redirects.find((doc) => doc._id === id) ?? null),
};

const favoriteLists: Doc[] = [
  {
    _id: { toString: () => 'list-1' },
    name: 'Saved before the re-key',
    description: '',
    privacy: 'PRIVATE',
    ownerId: 'user-1',
    tenantId: TENANT,
    favorites: [OLD_ID, KEPT_ID, UNKNOWN_ID],
  },
];

const favoriteListModel = {
  findOne: (filter: Doc) => ({
    exec: async () =>
      favoriteLists.find((doc) =>
        matches({ ...doc, _id: (doc._id as any).toString() }, filter),
      ) ?? null,
  }),
};

const headers: HeadersDto = { 'accept-language': 'en', 'x-tenant-id': TENANT };

describe('Batch lookup follows tenant-scoped redirects (ISS-2516)', () => {
  let resourceService: ResourceService;
  let favoriteListService: FavoriteListService;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResourceService,
        FavoriteListService,
        { provide: getModelToken(Resource.name), useValue: resourceModel },
        { provide: getModelToken(Redirect.name), useValue: redirectModel },
        {
          provide: getModelToken(FavoriteList.name),
          useValue: favoriteListModel,
        },
      ],
    }).compile();

    resourceService = moduleRef.get(ResourceService);
    favoriteListService = moduleRef.get(FavoriteListService);
  });

  it('an old id comes back as the new record, under the id that was asked for', async () => {
    const result = await resourceService.findManyByIds([OLD_ID, KEPT_ID], {
      headers,
    });

    expect(result.data[OLD_ID]?.serviceAtLocationId).toBe(NEW_ID);
    expect(result.data[KEPT_ID]?.serviceAtLocationId).toBe(KEPT_ID);
    expect(result.redirects).toEqual({ [OLD_ID]: NEW_ID });
    expect(result.errors).toEqual([]);
    expect(result.meta).toEqual({ requested: 2, successful: 2, failed: 0 });
  });

  it('an id with no redirect is still reported missing', async () => {
    const result = await resourceService.findManyByIds([UNKNOWN_ID], {
      headers,
    });

    expect(result.data).toEqual({});
    expect(result.errors).toEqual([
      { id: UNKNOWN_ID, reason: 'Resource not found', statusCode: 404 },
    ]);
    expect(result.redirects ?? {}).toEqual({});
  });

  it("another tenant's redirect row is not followed", async () => {
    const result = await resourceService.findManyByIds([OTHER_TENANTS_OLD_ID], {
      headers,
    });

    expect(result.data).toEqual({});
    expect(result.errors.map((e) => e.id)).toEqual([OTHER_TENANTS_OLD_ID]);
    expect(result.redirects ?? {}).toEqual({});
  });

  it('a redirect whose target does not resolve is reported missing', async () => {
    const result = await resourceService.findManyByIds([DANGLING_OLD_ID], {
      headers,
    });

    expect(result.data).toEqual({});
    expect(result.errors.map((e) => e.id)).toEqual([DANGLING_OLD_ID]);
  });

  it("a printable directory's titles follow the tenant's redirects, keyed by the requested id", async () => {
    const titles = await resourceService.findTitlesByIds(
      [OLD_ID, KEPT_ID, OTHER_TENANTS_OLD_ID, UNKNOWN_ID],
      TENANT,
    );

    expect(titles).toEqual(
      expect.arrayContaining([
        { id: OLD_ID, displayName: `Resource ${NEW_ID}` },
        { id: KEPT_ID, displayName: `Resource ${KEPT_ID}` },
      ]),
    );
    expect(titles).toHaveLength(2);
  });

  it('an old id in a logged-in favorite list resolves to the new record', async () => {
    const list = await favoriteListService.findOne('list-1', headers);

    expect(list.favorites.map((f: any) => f.serviceAtLocationId)).toEqual([
      NEW_ID,
      KEPT_ID,
    ]);
  });
});

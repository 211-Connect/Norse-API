import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import {
  SharingWithheldService,
  SharingWithheldVersion,
} from 'src/common/schemas/sharing-withholding.schema';
import {
  MAX_WITHHELD_SERVICE_IDS_PER_REQUEST,
  WITHHOLDING_CACHE_SERVICE_IDS,
  WithholdingService,
} from './withholding.service';

type Doc = Record<string, unknown>;

/** Enough of Mongo's filter language for the queries the service sends. */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    const value = doc[key] ?? null;
    if (cond !== null && typeof cond === 'object') {
      const ops = cond as Record<string, number>;
      if ('$lte' in ops && !(value !== null && (value as number) <= ops.$lte))
        return false;
      if ('$gt' in ops && !(value !== null && (value as number) > ops.$gt))
        return false;
      return true;
    }
    return value === cond;
  });
}

function fakeModel(docs: Doc[]) {
  const readPreferences: string[] = [];
  const query = (result: () => unknown) => {
    const q = {
      read: (pref: string) => {
        readPreferences.push(pref);
        return q;
      },
      lean: () => q,
      exec: async () => result(),
    };
    return q;
  };
  return {
    docs,
    readPreferences,
    find: jest.fn((filter: Doc) =>
      query(() => docs.filter((d) => matches(d, filter))),
    ),
    findOne: jest.fn((filter: Doc) =>
      query(() => docs.find((d) => matches(d, filter)) ?? null),
    ),
  };
}

const A = 'agreement-1';
const OWNER = 'writer-owner';

const withheld = (
  serviceId: string,
  version: number,
  liftedVersion: number | null = null,
): Doc => ({
  _id: `${A}:${OWNER}:${serviceId}`,
  agreementId: A,
  ownerWriterId: OWNER,
  serviceId,
  version,
  liftedVersion,
});

const header = (version: number, serviceCount: number): Doc => ({
  _id: `${A}:${OWNER}`,
  agreementId: A,
  ownerWriterId: OWNER,
  version,
  serviceCount,
});

describe('WithholdingService', () => {
  let services: ReturnType<typeof fakeModel>;
  let versions: ReturnType<typeof fakeModel>;
  let withholding: WithholdingService;

  const build = (serviceDocs: Doc[], versionDocs: Doc[]) => {
    services = fakeModel(serviceDocs);
    versions = fakeModel(versionDocs);
    withholding = new WithholdingService(
      services as unknown as Model<SharingWithheldService>,
      versions as unknown as Model<SharingWithheldVersion>,
    );
  };

  const ref = (version: number) => ({
    agreementId: A,
    ownerWriterId: OWNER,
    version,
  });

  it('loads the services withheld at exactly the version asked for', async () => {
    build(
      [
        withheld('s1', 1),
        withheld('s2', 2),
        // lifted at 3: still withheld at 2
        withheld('s3', 1, 3),
        // withheld at 3: not yet at 2
        withheld('s4', 3),
        // lifted at 2: gone at 2
        withheld('s5', 1, 2),
      ],
      [header(2, 3)],
    );
    const [set] = await withholding.resolve([ref(2)]);
    expect(set).toEqual({
      agreementId: A,
      ownerWriterId: OWNER,
      version: 2,
      serviceIds: ['s1', 's2', 's3'],
    });
  });

  it('answers 503 when the projection holds an older version (lagging), never the older set', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await expect(withholding.resolve([ref(2)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(services.find).not.toHaveBeenCalled();
  });

  it('answers 503 when the Withholding was never projected', async () => {
    build([], []);
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 409 when the projection has moved past the version asked for', async () => {
    build([withheld('s1', 1)], [header(3, 1)]);
    await expect(withholding.resolve([ref(2)])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('answers 503 when the services read do not add up to the count the header states', async () => {
    build([withheld('s1', 1)], [header(1, 2)]);
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503, not 500, when MongoDB fails', async () => {
    build([], [header(1, 0)]);
    versions.findOne.mockImplementation(() => {
      throw new Error('connection reset');
    });
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses two versions of one Withholding in one request', async () => {
    build([], [header(1, 0)]);
    await expect(withholding.resolve([ref(1), ref(2)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reads a repeated reference once', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    const sets = await withholding.resolve([ref(1), ref(1)]);
    expect(sets).toHaveLength(1);
    expect(versions.findOne).toHaveBeenCalledTimes(1);
  });

  it('caches by version, so a later version is read again and a cached one is not', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    await withholding.resolve([ref(1)]);
    expect(services.find).toHaveBeenCalledTimes(1);

    services.docs.push(withheld('s2', 2));
    versions.docs.splice(0, 1, header(2, 2));
    const [set] = await withholding.resolve([ref(2)]);
    expect(set.serviceIds).toEqual(['s1', 's2']);
    expect(services.find).toHaveBeenCalledTimes(2);
  });

  it('confirms the header on every cache hit', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    await withholding.resolve([ref(1)]);
    expect(versions.findOne).toHaveBeenCalledTimes(2);
  });

  it('reloads a cached version whose header count no longer matches (a restore or reconcile reused it)', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);

    services.docs.splice(0, 1, withheld('s7', 1), withheld('s8', 1));
    versions.docs.splice(0, 1, header(1, 2));
    const [set] = await withholding.resolve([ref(1)]);
    expect(set.serviceIds).toEqual(['s7', 's8']);
    expect(services.find).toHaveBeenCalledTimes(2);
  });

  it('answers 409 on a cache hit once the header has moved past the version', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    versions.docs.splice(0, 1, header(2, 1));
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('fails closed when the reload after a count mismatch still does not add up', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    versions.docs.splice(0, 1, header(1, 3));
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reads the header and the services from the primary', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    expect(versions.readPreferences).toEqual(['primary']);
    expect(services.readPreferences).toEqual(['primary']);
  });

  it('reads a cold Withholding once for concurrent requests', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    const sets = await Promise.all([
      withholding.resolve([ref(1)]),
      withholding.resolve([ref(1)]),
      withholding.resolve([ref(1)]),
    ]);
    expect(sets.map(([set]) => set.serviceIds)).toEqual([
      ['s1'],
      ['s1'],
      ['s1'],
    ]);
    expect(services.find).toHaveBeenCalledTimes(1);
  });

  it('answers 422 before reading any services when the Withholdings hold too many ids', async () => {
    const other = { ...header(1, 2), _id: 'x', ownerWriterId: 'writer-b' };
    build([], [header(1, MAX_WITHHELD_SERVICE_IDS_PER_REQUEST - 1), other]);
    const refused = withholding.resolve([
      ref(1),
      { agreementId: A, ownerWriterId: 'writer-b', version: 1 },
    ]);
    await expect(refused).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(refused).rejects.toThrow(
      String(MAX_WITHHELD_SERVICE_IDS_PER_REQUEST),
    );
    expect(services.find).not.toHaveBeenCalled();
  });

  it('bounds the cache by the ids it holds, not only by entries', async () => {
    const perSet = Math.floor(WITHHOLDING_CACHE_SERVICE_IDS / 2);
    const owners = ['o1', 'o2', 'o3'];
    const serviceDocs = owners.flatMap((owner) =>
      Array.from({ length: perSet }, (_, i) => ({
        ...withheld(`${owner}-s${i}`, 1),
        ownerWriterId: owner,
      })),
    );
    build(
      serviceDocs,
      owners.map((owner) => ({ ...header(1, perSet), ownerWriterId: owner })),
    );
    const refOf = (owner: string) => ({
      agreementId: A,
      ownerWriterId: owner,
      version: 1,
    });
    for (const owner of owners) await withholding.resolve([refOf(owner)]);
    expect(services.find).toHaveBeenCalledTimes(3);

    await withholding.resolve([refOf('o3')]);
    await withholding.resolve([refOf('o2')]);
    expect(services.find).toHaveBeenCalledTimes(3);
    await withholding.resolve([refOf('o1')]);
    expect(services.find).toHaveBeenCalledTimes(4);
  });

  it('does not cache a refusal', async () => {
    build([withheld('s1', 1)], [header(0, 0)]);
    await expect(withholding.resolve([ref(1)])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    versions.docs.splice(0, 1, header(1, 1));
    const [set] = await withholding.resolve([ref(1)]);
    expect(set.serviceIds).toEqual(['s1']);
  });

  it('scopes each read to its Agreement and owner', async () => {
    build([withheld('s1', 1)], [header(1, 1)]);
    await withholding.resolve([ref(1)]);
    expect(versions.findOne.mock.calls[0][0]).toEqual({
      agreementId: A,
      ownerWriterId: OWNER,
    });
    expect(services.find.mock.calls[0][0]).toMatchObject({
      agreementId: A,
      ownerWriterId: OWNER,
    });
  });
});

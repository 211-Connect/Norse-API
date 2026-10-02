import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SharingWithheldService,
  SharingWithheldVersion,
} from 'src/common/schemas/sharing-withholding.schema';

/** A Withholding named by reference: whose, under which Agreement, at which version. */
export interface WithholdingRef {
  agreementId: string;
  ownerWriterId: string;
  version: number;
}

/** The serviceIds a Withholding holds at exactly its version. */
export interface WithheldServices extends WithholdingRef {
  serviceIds: readonly string[];
}

/** A cached set is dropped when either bound is passed. */
export const WITHHOLDING_CACHE_ENTRIES = 64;
/** ES's default `index.max_terms_count`: one `terms` clause's worth of ids. */
export const MAX_WITHHELD_SERVICE_IDS_PER_REQUEST = 65_536;
export const WITHHOLDING_CACHE_SERVICE_IDS =
  2 * MAX_WITHHELD_SERVICE_IDS_PER_REQUEST;

const key = (r: Omit<WithholdingRef, 'version'>) =>
  `${r.agreementId}\u0000${r.ownerWriterId}`;

const describeRef = (ref: WithholdingRef) =>
  `Withholding ${ref.agreementId}/${ref.ownerWriterId} at version ${ref.version}`;

/**
 * Reads ServiceNet's Withholdings from the projection it writes into MongoDB
 * (ServiceNet ADR 0022). A set is served only at the exact version asked for:
 * a lagging projection is a 503 and a newer one a 409, never an older set
 * standing in for the one named. The header is confirmed on every request, so
 * a cached set answers only while the header still names its version and count.
 */
@Injectable()
export class WithholdingService {
  private readonly logger = new Logger(WithholdingService.name);
  private readonly cache = new Map<string, readonly string[]>();
  private cachedIds = 0;
  private readonly loading = new Map<string, Promise<readonly string[]>>();

  constructor(
    @InjectModel(SharingWithheldService.name)
    private readonly services: Model<SharingWithheldService>,
    @InjectModel(SharingWithheldVersion.name)
    private readonly versions: Model<SharingWithheldVersion>,
  ) {}

  async resolve(refs: readonly WithholdingRef[]): Promise<WithheldServices[]> {
    const distinct = new Map<string, WithholdingRef>();
    for (const ref of refs) {
      const seen = distinct.get(key(ref));
      if (seen && seen.version !== ref.version) {
        throw new BadRequestException(
          `exclude.withholdings names Withholding ${ref.agreementId}/${ref.ownerWriterId} at two versions`,
        );
      }
      distinct.set(key(ref), ref);
    }
    const confirmed = await Promise.all(
      [...distinct.values()].map(async (ref) => ({
        ref,
        serviceCount: await this.confirmHeader(ref),
      })),
    );
    const total = confirmed.reduce((sum, c) => sum + c.serviceCount, 0);
    if (total > MAX_WITHHELD_SERVICE_IDS_PER_REQUEST) {
      throw new UnprocessableEntityException(
        `exclude.withholdings withhold ${total} services in all; at most ${MAX_WITHHELD_SERVICE_IDS_PER_REQUEST} can be applied to one request`,
      );
    }
    return Promise.all(
      confirmed.map(async ({ ref, serviceCount }) => ({
        ...ref,
        serviceIds: await this.load(ref, serviceCount),
      })),
    );
  }

  /** The header's serviceCount, once it names exactly the version asked for. */
  private async confirmHeader(ref: WithholdingRef): Promise<number> {
    const named = describeRef(ref);
    const header = await this.guard(named, () =>
      this.versions
        .findOne({
          agreementId: ref.agreementId,
          ownerWriterId: ref.ownerWriterId,
        })
        .read('primary')
        .lean()
        .exec(),
    );
    const held = header?.version ?? 0;
    if (held < ref.version) {
      throw new ServiceUnavailableException(
        `${named} is not projected yet (the projection holds version ${held}); its withheld services cannot be applied`,
      );
    }
    if (held > ref.version) {
      throw new ConflictException(
        `${named} is superseded by version ${held}; read the Withholding again`,
      );
    }
    return header?.serviceCount ?? 0;
  }

  private async load(
    ref: WithholdingRef,
    serviceCount: number,
  ): Promise<readonly string[]> {
    const cacheKey = `${key(ref)}\u0000${ref.version}`;
    const hit = this.cache.get(cacheKey);
    this.forget(cacheKey);
    if (hit?.length === serviceCount) {
      this.remember(cacheKey, hit);
      return hit;
    }
    let pending = this.loading.get(cacheKey);
    if (!pending) {
      pending = this.readServices(ref).finally(() =>
        this.loading.delete(cacheKey),
      );
      this.loading.set(cacheKey, pending);
    }
    const serviceIds = await pending;
    if (serviceIds.length !== serviceCount) {
      throw new ServiceUnavailableException(
        `${describeRef(ref)} states ${serviceCount} services and ${serviceIds.length} were read; the projection is being rewritten`,
      );
    }
    this.forget(cacheKey);
    this.remember(cacheKey, serviceIds);
    return serviceIds;
  }

  /**
   * From the primary: ServiceNet writes the header last, a lift sets
   * liftedVersion > V and an add sets version > V, so V stays readable here.
   */
  private async readServices(ref: WithholdingRef): Promise<readonly string[]> {
    const docs = await this.guard(describeRef(ref), () =>
      this.services
        .find(
          {
            agreementId: ref.agreementId,
            ownerWriterId: ref.ownerWriterId,
            version: { $lte: ref.version },
            $or: [
              { liftedVersion: null },
              { liftedVersion: { $gt: ref.version } },
            ],
          },
          { serviceId: 1, _id: 0 },
        )
        .read('primary')
        .lean()
        .exec(),
    );
    return [...new Set(docs.map((d) => d.serviceId))];
  }

  private remember(cacheKey: string, serviceIds: readonly string[]) {
    this.cache.set(cacheKey, serviceIds);
    this.cachedIds += serviceIds.length;
    while (
      this.cache.size > WITHHOLDING_CACHE_ENTRIES ||
      this.cachedIds > WITHHOLDING_CACHE_SERVICE_IDS
    ) {
      this.forget(this.cache.keys().next().value as string);
    }
  }

  private forget(cacheKey: string) {
    const held = this.cache.get(cacheKey);
    if (!held) return;
    this.cache.delete(cacheKey);
    this.cachedIds -= held.length;
  }

  private async guard<T>(named: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`Reading ${named} failed`, e as Error);
      throw new ServiceUnavailableException(`${named} could not be read`);
    }
  }
}

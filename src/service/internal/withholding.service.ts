import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
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

/** Entries, not ids: one Withholding's set is one entry however large. */
export const WITHHOLDING_CACHE_ENTRIES = 64;

const key = (r: Omit<WithholdingRef, 'version'>) =>
  `${r.agreementId}\u0000${r.ownerWriterId}`;

/**
 * Reads ServiceNet's Withholdings from the projection it writes into MongoDB
 * (ServiceNet ADR 0022). A set is served only at the exact version asked for:
 * a lagging projection is a 503 and a newer one a 409, never an older set
 * standing in for the one named. Cached by version, so a stale entry cannot
 * answer for a newer one.
 */
@Injectable()
export class WithholdingService {
  private readonly logger = new Logger(WithholdingService.name);
  private readonly cache = new Map<string, readonly string[]>();

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
    return Promise.all(
      [...distinct.values()].map(async (ref) => ({
        ...ref,
        serviceIds: await this.load(ref),
      })),
    );
  }

  private async load(ref: WithholdingRef): Promise<readonly string[]> {
    const cacheKey = `${key(ref)}\u0000${ref.version}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, hit);
      return hit;
    }
    const serviceIds = await this.read(ref);
    this.cache.set(cacheKey, serviceIds);
    if (this.cache.size > WITHHOLDING_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return serviceIds;
  }

  private async read(ref: WithholdingRef): Promise<readonly string[]> {
    const scope = {
      agreementId: ref.agreementId,
      ownerWriterId: ref.ownerWriterId,
    };
    const named = `Withholding ${ref.agreementId}/${ref.ownerWriterId} at version ${ref.version}`;
    try {
      const header = await this.versions.findOne(scope).lean().exec();
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
      const docs = await this.services
        .find(
          {
            ...scope,
            version: { $lte: ref.version },
            $or: [
              { liftedVersion: null },
              { liftedVersion: { $gt: ref.version } },
            ],
          },
          { serviceId: 1, _id: 0 },
        )
        .lean()
        .exec();
      const serviceIds = [...new Set(docs.map((d) => d.serviceId))];
      if (serviceIds.length !== header?.serviceCount) {
        throw new ServiceUnavailableException(
          `${named} states ${String(header?.serviceCount)} services and ${serviceIds.length} were read; the projection is being rewritten`,
        );
      }
      return serviceIds;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`Reading ${named} failed`, e as Error);
      throw new ServiceUnavailableException(`${named} could not be read`);
    }
  }
}

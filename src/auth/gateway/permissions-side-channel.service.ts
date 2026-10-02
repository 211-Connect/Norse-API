import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PermissionsResponseDto } from '../dto/permissions-response.dto';

export type PermissionsResult = 'hit' | 'miss' | 'not_found' | 'unavailable';

// ADR-0015: scope edits, revocations, and disables must propagate within
// 60s (replaces v0's "instant on next request" guarantee) - this is the
// only staleness budget, there is no stale-on-error fallback.
export const PERMISSIONS_CACHE_TTL_MS = 60_000;
export const PERMISSIONS_CACHE_MAX = 1_000;

@Injectable()
export class PermissionsSideChannelService {
  private readonly logger = new Logger(PermissionsSideChannelService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs = 10_000;
  private readonly cache: LRUCache<string, string[]>;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('permissionsSideChannelUrl');
    this.cache = new LRUCache<string, string[]>({
      max: PERMISSIONS_CACHE_MAX,
      ttl: PERMISSIONS_CACHE_TTL_MS,
    });
  }

  async resolveSlugs(keyId: string): Promise<string[]> {
    const trimmedKeyId = keyId?.trim();
    if (!trimmedKeyId) {
      throw new UnauthorizedException('gateway_identity_required');
    }

    const cached = this.cache.get(trimmedKeyId);
    if (cached) {
      this.logger.debug(
        `Permissions cache hit: keyId=${trimmedKeyId} slugCount=${cached.length}`,
      );
      return cached;
    }

    const slugs = await this.fetchSlugs(trimmedKeyId);
    this.cache.set(trimmedKeyId, slugs);
    this.logger.debug(
      `Permissions cache miss (fetched): keyId=${trimmedKeyId} slugCount=${slugs.length}`,
    );
    return slugs;
  }

  private async fetchSlugs(keyId: string): Promise<string[]> {
    const url = `${this.baseUrl}/keys/${encodeURIComponent(keyId)}/permissions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      this.logger.warn(
        `Permissions side-channel unreachable: method=GET path unavailable keyId=${keyId}`,
      );
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    if (response.status === 404) {
      this.logger.warn(
        `Permissions side-channel key not found: result=not_found keyId=${keyId}`,
      );
      throw new UnauthorizedException('gateway_key_not_found');
    }

    if (response.status !== 200) {
      this.logger.warn(
        `Permissions side-channel unexpected status: result=unavailable status=${response.status} keyId=${keyId}`,
      );
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.warn(
        `Permissions side-channel non-JSON response: result=unavailable keyId=${keyId}`,
      );
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    const dto = plainToInstance(PermissionsResponseDto, body);
    const errors = await validate(dto);
    if (errors.length > 0) {
      this.logger.warn(
        `Permissions side-channel malformed response: result=unavailable keyId=${keyId}`,
      );
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    if (dto.keyId !== keyId) {
      this.logger.warn(
        `Permissions side-channel keyId mismatch: result=unavailable keyId=${keyId}`,
      );
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    return [...new Set(dto.permissions)].sort();
  }
}

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ALLOWED_ENDPOINT,
  ANALYTICS_FETCH_TIMEOUT_MS,
} from '../internal/constants';
import { UmamiAuthService } from './umami-auth.service';

export interface UmamiFanOutOptions {
  timeoutMs?: number;
}

@Injectable()
export class UmamiHttpService {
  private readonly logger = new Logger(UmamiHttpService.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly umamiAuth: UmamiAuthService,
  ) {}

  getApiUrl(): string {
    const apiUrl = this.configService.get<string>('umami.apiUrl');
    if (!apiUrl) {
      throw new HttpException(
        'Umami is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return apiUrl;
  }

  async getToken(): Promise<string> {
    try {
      return this.umamiAuth.getToken();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const detail = err instanceof Error ? err.message : 'Unknown error';
      throw new HttpException(
        `Umami authentication failed: ${detail}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async umamiFetch<T = unknown>(
    websiteId: string,
    endpoint: ALLOWED_ENDPOINT,
    params: Record<string, string | number | undefined>,
    token: string,
    options: UmamiFanOutOptions = {},
  ): Promise<T> {
    const apiUrl = this.getApiUrl();
    const timeoutMs = options.timeoutMs ?? ANALYTICS_FETCH_TIMEOUT_MS;

    const qs = buildQuery(params);
    const url = `${apiUrl}/api/websites/${encodeURIComponent(websiteId)}/${endpoint}${qs ? `?${qs}` : ''}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(
          `Umami request timed out after ${timeoutMs}ms (website=${websiteId}, endpoint=${endpoint})`,
        );
      }
      const message = err instanceof Error ? err.message : 'Network error';
      throw new Error(
        `Umami network error (website=${websiteId}, endpoint=${endpoint}): ${message}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Umami API error for website ${websiteId} (${res.status}): ${body}`,
      );
    }

    const response = await res.json();
    return response as T;
  }

  /**
   * Issues the same call against N websites in parallel and returns the
   * raw array of responses, ready to feed to `aggregateByEndpoint`.
   *
   * Any single failure rejects the whole call with `502 Bad Gateway` so the
   * caller surfaces a single deterministic error to Norse. We deliberately
   * do **not** soft-fail individual websites here — analytics responses
   * are merged numerically and partial data would silently understate the
   * totals.
   */
  async fanOut<T = unknown>(
    websiteIds: string[],
    endpoint: ALLOWED_ENDPOINT,
    params: Record<string, string | number | undefined>,
    options: UmamiFanOutOptions = {},
  ): Promise<T[]> {
    const token = await this.getToken();

    try {
      return await Promise.all(
        websiteIds.map((websiteId) =>
          this.umamiFetch<T>(websiteId, endpoint, params, token, options),
        ),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Umami fan-out failed (endpoint=${endpoint}, websites=${websiteIds.length}): ${detail}`,
      );
      throw new HttpException(
        `Failed to reach Umami API: ${detail}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

/** Stringifies a flat key/value map as a URL query string, dropping undefined. */
function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    usp.set(key, String(value));
  }
  return usp.toString();
}

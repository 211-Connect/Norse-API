import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AUTH_LOGIN_TIMEOUT_MS,
  AUTH_VERIFY_TIMEOUT_MS,
} from '../internal/constants';

interface UmamiConfig {
  apiUrl: string;
  username: string;
  password: string;
}

interface UmamiLoginResponse {
  token?: string;
}

@Injectable()
export class UmamiAuthService {
  private readonly logger = new Logger(UmamiAuthService.name);

  private cachedToken: string | null = null;
  private inflight: Promise<string> | null = null;
  private tokenGeneration = 0;

  constructor(private readonly configService: ConfigService) {}

  async getToken(): Promise<string> {
    if (this.cachedToken && (await this.isTokenValid(this.cachedToken))) {
      return this.cachedToken;
    }

    if (this.inflight) {
      return this.inflight;
    }

    const generation = ++this.tokenGeneration;

    this.inflight = this.login()
      .then((token) => {
        // Only cache the token if no invalidation happened while we were logging in
        if (generation === this.tokenGeneration) {
          this.cachedToken = token;
        }
        return token;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  invalidate(): void {
    this.cachedToken = null;
    this.tokenGeneration++;
  }

  private async isTokenValid(token: string): Promise<boolean> {
    const { apiUrl } = this.requireConfig();
    try {
      const res = await fetch(`${apiUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(AUTH_VERIFY_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async login(): Promise<string> {
    const { apiUrl, username, password } = this.requireConfig();

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(AUTH_LOGIN_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      this.logger.error(`Umami login network failure: ${message}`);
      throw new Error(`Umami login network failure: ${message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Umami login failed (status=${res.status})}`);
      throw new Error(`Umami login failed (${res.status}): ${body}`);
    }

    const data = (await res.json().catch(() => ({}))) as UmamiLoginResponse;
    if (!data?.token) {
      throw new Error('Umami login response did not include a token.');
    }
    return data.token;
  }

  private requireConfig(): UmamiConfig {
    const apiUrl = this.configService.get<string>('umami.apiUrl');
    const username = this.configService.get<string>('umami.username');
    const password = this.configService.get<string>('umami.password');

    if (!apiUrl || !username || !password) {
      throw new HttpException(
        'Umami is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { apiUrl, username, password };
  }
}

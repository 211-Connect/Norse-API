import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

type ScanArgs = {
  cursor: string;
  match: string;
  count: number;
};

/**
 * Some data need to be shared between PayloadCMS and Norse API.
 * PayloadCMS write these data to Redis DB 2, and Norse API read from it.
 * This service is responsible for connecting to Redis DB 2 and providing methods to read data from it.
 */
@Injectable()
export class CmsRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CmsRedisService.name);
  private client: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    const redisUrl = this.configService.get<string>('CMS_REDIS_URL');
    this.client = createClient({
      url: redisUrl,
      database: 2,
      socket: {
        keepAlive: true,
        connectTimeout: 10_000,
        keepAliveInitialDelay: 0,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            this.logger.error(
              'Redis (DB 2): Max reconnection attempts reached',
            );
            return new Error('Max reconnection attempts reached');
          }
          const delay = Math.min(Math.max(100, retries * 100), 5000);
          this.logger.warn(
            `Redis (DB 2): Reconnecting in ${delay}ms (attempt ${retries + 1})`,
          );
          return delay;
        },
      },
      pingInterval: 30_000,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis (DB 2) client error: ${err.message}`, err.stack);
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('Redis (DB 2): Reconnecting...');
    });

    this.client.on('ready', () => {
      this.logger.log('Redis (DB 2): Connection ready');
    });

    this.client.on('end', () => {
      this.logger.warn('Redis (DB 2): Connection ended');
    });

    this.client.on('connect', () => {
      this.logger.log('Redis (DB 2): Socket connected');
    });

    try {
      await this.client.connect();
      this.logger.log('Redis client (DB 2) connected and ready');
    } catch (error) {
      this.logger.error(
        `Failed to connect to Redis (DB 2): ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis client (DB 2) disconnected');
    }
  }

  private getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    if (!this.client.isOpen) {
      throw new Error('Redis client not connected');
    }
    if (!this.client.isReady) {
      throw new Error('Redis client not ready (possibly reconnecting)');
    }
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client?.isOpen || !this.client?.isReady) {
        return false;
      }
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.warn(`Redis (DB 2) health check failed: ${error.message}`);
      return false;
    }
  }

  scan({
    count,
    cursor,
    match,
  }: ScanArgs): Promise<{ cursor: string; keys: string[] }> {
    return this.getClient().scan(cursor, { MATCH: match, COUNT: count });
  }

  get(key: string) {
    return this.getClient().get(key);
  }

  async mGet(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }

    const result = await this.getClient().mGet(keys);

    return result.map((value) => (typeof value === 'string' ? value : null));
  }
}

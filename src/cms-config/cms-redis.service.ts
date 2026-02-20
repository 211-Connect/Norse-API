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
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            this.logger.error(
              'Redis (DB 2): Max reconnection attempts reached',
            );
            return new Error('Max reconnection attempts reached');
          }
          const delay = Math.min(retries * 100, 3000);
          this.logger.warn(
            `Redis (DB 2): Reconnecting in ${delay}ms (attempt ${retries})`,
          );
          return delay;
        },
      },
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

    await this.client.connect();
    this.logger.log('Redis client (DB 2) connected');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis client (DB 2) disconnected');
    }
  }

  private getClient(): RedisClientType {
    if (!this.client || !this.client.isReady) {
      throw new Error('Redis client not ready');
    }
    return this.client;
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

  async mGet(keys: string[]): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }

    const result = await this.getClient().mGet(keys);
    return result.filter((value): value is string => typeof value === 'string');
  }
}

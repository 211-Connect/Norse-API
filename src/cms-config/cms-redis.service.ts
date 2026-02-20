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
    const redisUrl = this.configService.get<string>('CMS_REDIS_URL');
    this.client = createClient({
      url: redisUrl,
      database: 2,
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
    if (!this.client) {
      throw new Error('Redis client not initialized');
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

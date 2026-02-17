import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { stringify } from 'csv-stringify/sync';
import { CustomAttribute } from './types/custom-attribute';
import { CustomAttributeCsvRow } from './types/custom-attribute-csv-row';

@Injectable()
export class CustomAttributesConfigService {
  private readonly logger = new Logger(CustomAttributesConfigService.name);
  private redisClient: RedisClientType;

  private readonly headers = [
    'source_column',
    'link_entity',
    'label',
    'provenance',
  ];

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.redisClient = createClient({
      url: redisUrl,
      database: 2,
    });

    await this.redisClient.connect();
  }

  onModuleDestroy() {
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
  }

  async getCustomAttributesAsCsv(tenantId: string): Promise<string> {
    const cacheKey = `custom_attributes:${tenantId}`;

    try {
      const cachedData = await this.redisClient.get(cacheKey);

      if (!cachedData || typeof cachedData !== 'string') {
        this.logger.warn(`No custom attributes found for tenant: ${tenantId}`);
        return stringify([], {
          header: true,
          columns: this.headers,
        });
      }

      const attributes: CustomAttribute[] = JSON.parse(cachedData);

      const csvRows: CustomAttributeCsvRow[] = attributes.map((attr) => ({
        source_column: attr.source_column,
        link_entity: attr.link_entity,
        label: attr.label.en || '',
        provenance: attr.provenance || '',
      }));

      const csv = stringify(csvRows, {
        header: true,
        columns: this.headers,
      });

      return csv;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve custom attributes for tenant ${tenantId}`,
        error.stack,
      );
      return stringify([], {
        header: true,
        columns: this.headers,
      });
    }
  }
}

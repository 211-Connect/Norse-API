import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { stringify } from 'csv-stringify/sync';
import { OrchestrationConfigCache } from './types';

@Injectable()
export class OrchestrationConfigService {
  private readonly logger = new Logger(OrchestrationConfigService.name);
  private redisClient: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.redisClient = createClient({
      url: redisUrl,
      database: 2,
    });

    await this.redisClient.connect();
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      this.redisClient.destroy();
    }
  }

  async getCustomAttributes(schemaName?: string): Promise<string> {
    this.logger.debug(
      `Getting custom attributes${schemaName ? ` for schema: ${schemaName}` : ' (all schemas)'}`,
    );

    try {
      const attributesMap = new Map<
        string,
        {
          source_column: string;
          link_entity: string;
          label: string;
          origin: string;
        }
      >();

      let cursor = '0';
      let iterations = 0;
      const maxIterations = 1000;

      this.logger.debug(
        `Starting Redis SCAN with pattern: orchestration_config:*`,
      );

      do {
        iterations += 1;
        if (iterations > maxIterations) {
          throw new InternalServerErrorException(
            'Exceeded maximum iterations while scanning Redis keys',
          );
        }

        const { cursor: newCursor, keys } = await this.redisClient.scan(
          cursor,
          { MATCH: 'orchestration_config:*', COUNT: 100 },
        );

        cursor = newCursor;

        this.logger.debug(
          `SCAN iteration ${iterations}: cursor=${cursor}, found ${keys.length} keys`,
        );

        if (keys.length > 0) {
          const values = await Promise.all(
            keys.map((key) => this.redisClient.get(key)),
          );

          for (let i = 0; i < values.length; i++) {
            const value = values[i];
            const key = keys[i];

            if (!value || typeof value !== 'string') {
              this.logger.warn(
                `Skipping key ${key}: value is ${value === null ? 'null' : typeof value}`,
              );
              continue;
            }

            try {
              const config: OrchestrationConfigCache = JSON.parse(value);

              const schemas = schemaName
                ? config.schemas.filter((s) => s.schemaName === schemaName)
                : config.schemas;

              for (const schema of schemas) {
                if (schema.customAttributes) {
                  for (const attr of schema.customAttributes) {
                    if (!attributesMap.has(attr.source_column)) {
                      attributesMap.set(attr.source_column, {
                        source_column: attr.source_column,
                        link_entity: attr.link_entity,
                        label: attr.label?.en || attr.source_column,
                        origin: attr.origin ?? '',
                      });
                    }
                  }
                }
              }
            } catch (error) {
              this.logger.error(
                `Failed to parse config from Redis key ${key}:`,
                error instanceof Error ? error.stack : error,
              );
            }
          }
        }
      } while (cursor !== '0');

      this.logger.debug(
        `Completed SCAN: found ${attributesMap.size} unique custom attributes`,
      );

      const csvRows = Array.from(attributesMap.values());
      const csv = stringify(csvRows, {
        header: true,
        columns: ['source_column', 'link_entity', 'label', 'origin'],
      });

      return csv;
    } catch (error) {
      this.logger.error(
        'Error in getCustomAttributes:',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve orchestration configuration',
      );
    }
  }
}

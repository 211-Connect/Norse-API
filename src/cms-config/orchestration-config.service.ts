import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { OrchestrationConfigCache } from './types';
import { CmsRedisService } from './cms-redis.service';

@Injectable()
export class OrchestrationConfigService {
  private readonly logger = new Logger(OrchestrationConfigService.name);

  constructor(private readonly cmsRedisService: CmsRedisService) {}

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
          provenance: string;
        }
      >();

      let cursor = '0';
      let iterations = 0;
      const maxIterations = 100;
      const scanCount = 100;

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

        const { cursor: newCursor, keys } = await this.cmsRedisService.scan({
          count: scanCount,
          cursor,
          match: 'orchestration_config:*',
        });

        cursor = newCursor;

        this.logger.debug(
          `SCAN iteration ${iterations}: cursor=${cursor}, found ${keys.length} keys`,
        );

        if (keys.length > 0) {
          const values = await this.cmsRedisService.mGet(keys);

          for (let i = 0; i < values.length; i++) {
            const value = values[i];
            const key = keys[i];

            if (!value) {
              this.logger.warn(`Skipping key ${key}: value is null`);
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
                        provenance: attr.provenance ?? '',
                      });
                    }
                  }
                }
              }
            } catch (error) {
              this.logger.warn(
                `Failed to parse config from Redis key ${key}. Skipping. Error: ${error instanceof Error ? error.message : error}`,
              );
            }
          }
        }
      } while (cursor !== '0');

      this.logger.debug(
        `Completed SCAN: found ${attributesMap.size} unique custom attributes`,
      );

      // Return empty string if no attributes found
      if (attributesMap.size === 0) {
        return '';
      }

      const csvRows = Array.from(attributesMap.values());
      const csv = stringify(csvRows, {
        header: true,
        columns: ['source_column', 'link_entity', 'label', 'provenance'],
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

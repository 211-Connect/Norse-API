import { SchemaConfig } from './schema-config';

/**
 * Orchestration config cache structure stored in Redis
 * Key format: orchestration_config:${tenantId}
 */
export interface OrchestrationConfigCache {
  tenantId: string;
  schemas: SchemaConfig[];
}

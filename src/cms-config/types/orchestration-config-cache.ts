import { SchemaConfig } from './schema-config';

export interface OrchestrationConfigCache {
  tenantId: string;
  schemas: SchemaConfig[];
}

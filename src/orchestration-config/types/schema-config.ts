import { CustomAttribute } from './custom-attribute';

/**
 * Schema configuration within an orchestration config
 */
export interface SchemaConfig {
  schemaName: string;
  customAttributes: CustomAttribute[];
}

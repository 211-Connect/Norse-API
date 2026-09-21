import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ServiceDocument = HydratedDocument<Service>;

/**
 * The service-rooted HSDS document (Mongo `services`).
 *
 * Written by `dagster-data-orchestration`'s `configurable-readers` from the
 * `APP_SERVICE_FULL` dbt model — one document per service carrying its parent
 * Organization and the Locations it is delivered at. Distinct from the
 * service-at-LOCATION grained `resources` collection, which carries no service
 * id at all.
 *
 * Deeply-nested HSDS sub-documents are stored as Mixed, matching
 * `organization.schema.ts`: only the fields the detail endpoint addresses are
 * typed precisely. The nested shapes are `OBJECT_CONSTRUCT(obj.*)` over dbt
 * views, so their key sets are not declared anywhere and may gain a column
 * upstream; typing them would invent a contract the producer never agreed to.
 */
@Schema({ collection: 'services' })
export class Service {
  @Prop()
  _id: string;

  @Prop({ index: true })
  serviceId: string;

  @Prop({ index: true, name: 'tenant_id' })
  tenant_id: string;

  @Prop({ index: true })
  resourceWriterId: string;

  @Prop()
  organizationId: string;

  @Prop()
  originalId: string;

  @Prop()
  name: string;

  @Prop()
  alternateName: string;

  @Prop()
  description: string;

  @Prop()
  status: string;

  @Prop({ type: Object })
  organization: Record<string, unknown> | null;

  @Prop({ type: [Object] })
  locations: Record<string, unknown>[];
}

export const ServiceSchema = SchemaFactory.createForClass(Service);

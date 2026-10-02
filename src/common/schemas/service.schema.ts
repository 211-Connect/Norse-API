import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ServiceDocument = HydratedDocument<Service>;

// One document per service, carrying its parent Organization and Locations.
// Distinct from `resources`, which is service-at-LOCATION grain and carries no
// service id.
//
// Nested sub-documents are Mixed, as in `organization.schema.ts`: their key
// sets come from `OBJECT_CONSTRUCT(obj.*)` over dbt views and are declared
// nowhere.
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

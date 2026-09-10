import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

export interface OrganizationTranslationEntry {
  ID?: string;
  LOCALE: string;
  DESCRIPTION?: string;
  IS_CANONICAL?: boolean;
  ORGANIZATION_ID?: string;
  RESOURCE_WRITER_ID?: string;
  TENANT_ID?: string;
}

export interface OrganizationServiceAtLocation {
  // ID is the serviceAtLocationId that keys the `resources` collection.
  ID: string;
  LOCATION_ID?: string;
}

export interface OrganizationServiceEntry {
  ID?: string;
  NAME?: string;
  SERVICE_AT_LOCATIONS?: OrganizationServiceAtLocation[];
  [key: string]: unknown;
}

// Source-of-truth org graph (Mongo `organizations`), distinct from the slim
// Elasticsearch `organizations` typeahead index used by /organization search.
// Deeply-nested HSDS sub-documents are stored as Mixed; only fields the detail
// endpoint reads are typed precisely.
@Schema({ collection: 'organizations' })
export class Organization {
  @Prop()
  _id: string;

  @Prop({ index: true })
  organizationId: string;

  @Prop({ index: true })
  originalId: string;

  @Prop()
  parentOrganizationId: string;

  @Prop({ index: true, name: 'tenant_id' })
  tenant_id: string;

  @Prop()
  resourceWriterId: string;

  @Prop()
  name: string;

  @Prop()
  alternateName: string;

  @Prop()
  email: string;

  @Prop()
  website: string;

  @Prop({ type: Object })
  logo: Record<string, unknown> | null;

  @Prop()
  legalStatus: string;

  @Prop()
  taxStatus: string;

  @Prop({ type: Object })
  yearIncorporated: Record<string, unknown> | null;

  @Prop({ type: Object })
  uri: Record<string, unknown> | null;

  @Prop({ type: [Object] })
  translations: OrganizationTranslationEntry[];

  @Prop({ type: [Object] })
  phones: Record<string, unknown>[];

  @Prop({ type: [Object] })
  contacts: Record<string, unknown>[];

  @Prop({ type: [Object] })
  locations: Record<string, unknown>[];

  @Prop({ type: [Object] })
  services: OrganizationServiceEntry[];

  @Prop({ type: [Object] })
  programs: Record<string, unknown>[];

  @Prop({ type: [Object] })
  funding: Record<string, unknown>[];

  @Prop({ type: [Object] })
  organizationIdentifiers: Record<string, unknown>[];
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

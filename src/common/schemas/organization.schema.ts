import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

/**
 * One entry of an organization's top-level `translations` array. Mirrors the
 * HSDS-style upper-cased shape stored in `search_engine.organizations`. Only
 * the organization-level DESCRIPTION is translated here; service/location/phone
 * level translations live in their own nested TRANSLATIONS arrays.
 */
export interface OrganizationTranslationEntry {
  ID?: string;
  LOCALE: string;
  DESCRIPTION?: string;
  IS_CANONICAL?: boolean;
  ORGANIZATION_ID?: string;
  RESOURCE_WRITER_ID?: string;
  TENANT_ID?: string;
}

/**
 * Link from a service to the location it is offered at. `ID` is the public
 * serviceAtLocationId (SAL) that keys the `resources` collection, so it is the
 * join used to hydrate `?include=resources`.
 */
export interface OrganizationServiceAtLocation {
  ID: string;
  LOCATION_ID?: string;
}

/**
 * One entry of an organization's `services` array. Typed loosely because the
 * nested HSDS graph is large; only the fields this endpoint reads are declared.
 */
export interface OrganizationServiceEntry {
  ID?: string;
  NAME?: string;
  SERVICE_AT_LOCATIONS?: OrganizationServiceAtLocation[];
  [key: string]: unknown;
}

/**
 * Mongoose model for the `search_engine.organizations` collection (the class
 * name pluralizes to `organizations`). This is the source-of-truth org graph,
 * distinct from the slim Elasticsearch `organizations` typeahead index used by
 * the /organization search route.
 *
 * The deeply-nested HSDS sub-documents (locations, services, phones, etc.) are
 * stored as Mixed and given light TypeScript shapes; only the fields the detail
 * endpoint reads are described precisely.
 */
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

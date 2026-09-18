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

/**
 * The resolved view of one service at one location: what a seeker is shown for
 * this pairing, after the tenant's ranking rules have run.
 *
 * Read-only. Every value is derived from a phone, contact or schedule row that
 * also appears, with its own ID, under the service, the location, or the
 * organization's top-level arrays. Write feedback against those rows.
 */
export interface OrganizationServiceAtLocationDisplay {
  /** Primary number for this pairing (the first PHONE_LIST entry). */
  PHONE_NUMBER?: string;
  /** Every phone in scope for this pairing, tenant-ranked. */
  PHONE_LIST?: Record<string, unknown>[];
  CONTACT_LIST?: Record<string, unknown>[];
  WEBSITE?: string;
  EMAIL?: string;
  /**
   * The single resolved schedule for this pairing, per locale. Named
   * TRANSLATIONS so the document-wide locale filter reaches it too.
   */
  TRANSLATIONS?: { LOCALE?: string; DISPLAY_SCHEDULE?: string }[];
}

export interface OrganizationServiceAtLocation {
  // ID is the serviceAtLocationId that keys the `resources` collection.
  ID: string;
  LOCATION_ID?: string;
  /**
   * Schedule rows attached to the pairing itself. HSDS allows a schedule to
   * hang off a service_at_location, and such a row carries neither a
   * service_id nor a location_id — so it appears here and nowhere else in the
   * document. Editable, unlike DISPLAY.
   */
  SCHEDULES?: Record<string, unknown>[];
  DISPLAY?: OrganizationServiceAtLocationDisplay;
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

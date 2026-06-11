import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ResourceDocument = HydratedDocument<Resource>;

type GeoCoordinates = [number, number];
type GeoPolygonCoordinates = GeoCoordinates[][];
type GeoMultiPolygonCoordinates = GeoPolygonCoordinates[];

@Schema({ _id: false })
export class Location {
  @Prop({ required: true, enum: ['Point'] })
  type: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates: GeoCoordinates;
}

@Schema({ _id: false })
export class ServiceAreaExtent {
  @Prop({ required: true, enum: ['Polygon', 'MultiPolygon'] })
  type: 'Polygon' | 'MultiPolygon';

  @Prop({ type: [[[[Number]]]], required: true })
  coordinates: GeoPolygonCoordinates | GeoMultiPolygonCoordinates;
}

@Schema({ _id: false })
export class ServiceArea {
  @Prop({ type: [String], default: [] })
  description: string[];

  @Prop({ type: ServiceAreaExtent, required: true })
  extent: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: GeoPolygonCoordinates | GeoMultiPolygonCoordinates;
  };
}

@Schema({ _id: false })
export class Taxonomy {
  @Prop()
  code: string;
  @Prop()
  name: string;
}

@Schema({ _id: false })
export class Facet {
  @Prop()
  code: string;
  @Prop()
  taxonomyName: string;
  @Prop()
  termName: string;
}

@Schema({ _id: false })
export class PhoneNumber {
  @Prop()
  type: string;
  @Prop()
  number: string;
  @Prop()
  rank: number;
}

@Schema({ _id: false })
export class Contact {
  @Prop()
  id: string;
  @Prop()
  name: string;
  @Prop()
  title?: string;
  @Prop()
  email?: string;
  @Prop({ type: [PhoneNumber] })
  phones?: PhoneNumber[];
  @Prop()
  priority: number;
}

@Schema({ _id: false })
export class LinkQualityUrl {
  @Prop()
  url: string;

  @Prop()
  displayText: string;
}

const taxonomySchema = SchemaFactory.createForClass(Taxonomy);
const facetSchema = SchemaFactory.createForClass(Facet);
const contactSchema = SchemaFactory.createForClass(Contact);
const linkQualityUrlSchema = SchemaFactory.createForClass(LinkQualityUrl);

@Schema({ timestamps: true })
export class Resource {
  @Prop({ index: true })
  originalId: string;

  @Prop()
  _id: string;

  @Prop()
  displayName: string;

  @Prop()
  displayPhonenumber: string;

  @Prop()
  website: string;

  @Prop()
  organizationUrl: string;

  @Prop()
  email: string;

  @Prop({ type: [PhoneNumber], default: [] })
  phoneNumbers: PhoneNumber[];

  @Prop()
  hours: string;

  @Prop()
  applicationProcess: string;

  @Prop()
  eligibilities: string;

  @Prop({ type: [String], default: [] })
  languages: string[];

  @Prop()
  fees: string;

  @Prop()
  requiredDocuments: string;

  @Prop({ index: true })
  tenantId: string;

  @Prop({ type: Location })
  location: {
    type: 'Point';
    coordinates: GeoCoordinates;
  };

  @Prop({ type: ServiceArea })
  serviceArea: {
    description: string[];
    extent: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: GeoPolygonCoordinates | GeoMultiPolygonCoordinates;
    };
  };

  @Prop()
  organizationName: string;

  @Prop({
    type: [
      {
        address_1: String,
        address_2: String,
        city: String,
        stateProvince: String,
        postalCode: String,
        country: String,
        type: String,
      },
    ],
    default: [],
  })
  addresses: {
    address_1: string;
    address_2: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
    type: string;
  }[];

  @Prop({
    type: [
      {
        displayName: String,
        fees: String,
        hours: String,
        locale: String,
        taxonomies: { type: [taxonomySchema], default: [] },
        serviceName: String,
        serviceDescription: String,
        organizationDescription: String,
        accessibility: String,
        transportation: String,
        facets: { type: [facetSchema], default: [] },
        attributeValues: { type: Object },
        contacts: { type: [contactSchema], default: [] },
        linkQualityUrls: { type: [linkQualityUrlSchema], default: [] },
      },
    ],
    default: [],
  })
  translations: {
    displayName: string;
    fees?: string;
    hours?: string;
    locale: string;
    taxonomies: Taxonomy[];
    serviceName: string;
    serviceDescription: string;
    organizationDescription: string;
    accessibility?: string;
    transportation?: string;
    facets?: Facet[];
    attributeValues?: Record<string, string>;
    contacts: Contact[];
    linkQualityUrls: LinkQualityUrl[];
  }[];

  @Prop()
  last_assured_date: string;
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);

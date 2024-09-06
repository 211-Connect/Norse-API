import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ResourceDocument = HydratedDocument<Resource>;

@Schema()
class Location {
  @Prop()
  type: 'Point';

  @Prop(Number)
  coordinates: number[];
}

@Schema()
class ServiceArea {
  @Prop([Number])
  description: string[];
  extent: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: [[[[number]]]]; // Array of arrays of arrays of numbers
  };
}

@Schema()
export class Resource {
  @Prop()
  _id: string;

  @Prop()
  displayName: string;

  @Prop()
  displayPhonenumber: string;

  @Prop()
  website: string;

  @Prop()
  email: string;

  @Prop()
  phoneNumbers: {
    type: string;
    number: string;
    rank: number;
  }[];

  @Prop()
  hours: string;

  @Prop()
  applicationProcess: string;

  @Prop()
  eligibilities: string;

  @Prop()
  languages: [string];

  @Prop()
  fees: string;

  @Prop()
  requiredDocuments: string;

  @Prop()
  tenantId: string;

  @Prop({ type: Location })
  location: {
    type: 'Point';
    coordinates: {
      type: [number];
      required: true;
    };
  };

  @Prop({ type: ServiceArea })
  serviceArea: {
    description: [string];
    extent: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: [[[[number]]]]; // Array of arrays of arrays of numbers
    };
  };

  @Prop()
  organizationName: string;

  @Prop()
  addresses: {
    address_1: string;
    address_2: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
    type: string;
  }[];

  @Prop()
  translations: {
    locale: string;
    serviceName: string;
    serviceDescription: string;
    organizationDescription: string;
  }[];

  @Prop()
  last_assured_date: string;
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);

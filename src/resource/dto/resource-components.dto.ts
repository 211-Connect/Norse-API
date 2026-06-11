import { ApiProperty } from '@nestjs/swagger';
import {
  Contact,
  Facet,
  LinkQualityUrl,
  PhoneNumber,
  Taxonomy,
} from '../types/resource-response.types';

export class ResourceTaxonomyDto implements Taxonomy {
  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;
}

export class ResourceFacetDto implements Facet {
  @ApiProperty()
  code: string;

  @ApiProperty()
  taxonomyName: string;

  @ApiProperty()
  termName: string;
}

export class ResourcePhoneNumberDto implements PhoneNumber {
  @ApiProperty()
  type: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  rank: number;
}

export class ResourceContactDto implements Contact {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  title?: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({ type: [ResourcePhoneNumberDto], required: false })
  phones?: PhoneNumber[];

  @ApiProperty()
  priority: number;
}

export class LinkQualityUrlDto implements LinkQualityUrl {
  @ApiProperty({
    description: 'URL to an external quality or compliance document',
    example: 'https://www.example.org/quality/survey.pdf',
  })
  url: string;

  @ApiProperty({
    description: 'Human-readable label for the quality document link',
    example: 'Department of Health - Assisted Living Survey',
  })
  displayText: string;
}

export class ResourceLocationDto {
  @ApiProperty({ example: 'Point' })
  type: string;

  @ApiProperty({ type: [Number], example: [-106.0746, 42.1485] })
  coordinates: number[];
}

export class ResourceServiceAreaExtentDto {
  @ApiProperty({ example: 'Polygon' })
  type: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      },
    },
  })
  coordinates: unknown;
}

export class ResourceServiceAreaDto {
  @ApiProperty({ type: [String] })
  description: string[];

  @ApiProperty({ type: ResourceServiceAreaExtentDto })
  extent: ResourceServiceAreaExtentDto;
}

export class ResourceAddressDto {
  @ApiProperty()
  address_1: string;

  @ApiProperty()
  address_2: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  stateProvince: string;

  @ApiProperty()
  postalCode: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  type: string;
}

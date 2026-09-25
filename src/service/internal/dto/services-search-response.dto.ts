import { ApiProperty } from '@nestjs/swagger';

export class ServiceListItemDto {
  @ApiProperty({
    description:
      'Document id, `<tenant_id>:<serviceId>`; the same id MongoDB `services` holds.',
  })
  id: string;

  @ApiProperty() serviceId: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() resourceWriterId: string;

  @ApiProperty({
    description: 'Always true here: only canonical publications are listed.',
  })
  isCanonicalPublication: boolean;

  @ApiProperty({ type: String, nullable: true }) status: string | null;
  @ApiProperty({ type: [String] }) taxonomyPath: string[];
  @ApiProperty({ type: [String] }) taxonomyCodes: string[];
  @ApiProperty({ type: [String] }) locationTypes: string[];
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) alternateName: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) organizationName:
    string | null;
  @ApiProperty({ type: String, nullable: true }) city: string | null;
  @ApiProperty({ type: String, nullable: true }) assuredDate: string | null;
}

export class ServicesSearchResponseDto {
  @ApiProperty({ type: [ServiceListItemDto] }) items: ServiceListItemDto[];
  @ApiProperty({ description: 'Every match, not just this page.' })
  total: number;
  @ApiProperty() offset: number;
  @ApiProperty() limit: number;
}

export class ContributorFacetDto {
  @ApiProperty() resourceWriterId: string;
  @ApiProperty() recordCount: number;
}

export class StatusFacetDto {
  @ApiProperty() value: string;
  @ApiProperty() recordCount: number;
}

export class TaxonomyFacetDto {
  @ApiProperty() code: string;
  @ApiProperty({ description: 'The code; there is no source for AIRS labels.' })
  name: string;
  @ApiProperty({ type: String, nullable: true }) parentCode: string | null;
  @ApiProperty({ description: 'Records at or under this node.' })
  recordCount: number;
  @ApiProperty({
    description: 'True when no record is coded with this node itself.',
  })
  synthesized: boolean;
}

export class ServicesFacetsResponseDto {
  @ApiProperty({ type: [ContributorFacetDto] })
  contributors: ContributorFacetDto[];
  @ApiProperty({ type: [StatusFacetDto] }) statuses: StatusFacetDto[];
  @ApiProperty({ type: [TaxonomyFacetDto] }) taxonomy: TaxonomyFacetDto[];
}

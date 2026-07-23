import { ApiProperty } from '@nestjs/swagger';

export class OrganizationLocationDto {
  @ApiProperty({ nullable: true }) address_1?: string | null;
  @ApiProperty({ nullable: true }) city?: string | null;
  @ApiProperty({ nullable: true }) state?: string | null;
  @ApiProperty({ nullable: true }) postal_code?: string | null;
}

export class OrganizationSearchSourceDto {
  @ApiProperty() organization_id: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty() resource_writer_id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) alternate_name?: string | null;
  @ApiProperty({ nullable: true }) email?: string | null;
  @ApiProperty({ nullable: true }) website?: string | null;
  @ApiProperty({ nullable: true }) phone?: string | null;
  @ApiProperty({ type: OrganizationLocationDto, nullable: true })
  location?: OrganizationLocationDto | null;
}

export class OrganizationSearchHitDto {
  @ApiProperty() _index: string;
  @ApiProperty() _id: string;
  @ApiProperty({ nullable: true }) _score?: number | null;
  @ApiProperty({ type: OrganizationSearchSourceDto })
  _source: OrganizationSearchSourceDto;
}

export class OrganizationSearchResponseDto {
  @ApiProperty() took: number;
  @ApiProperty() timed_out: boolean;
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ type: [OrganizationSearchHitDto] })
  hits: OrganizationSearchHitDto[];
}

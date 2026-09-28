import { ApiProperty } from '@nestjs/swagger';
import {
  RULE_VIRTUAL_MODES,
  RuleVirtualMode,
} from './services-search-request.dto';

/** A rule as applied: de-duplicated lists, empty when absent. */
export class ServicesAppliedExclusionRuleDto {
  @ApiProperty({ type: [String] }) taxonomyCodes: string[];
  @ApiProperty({ type: [String] }) regionIds: string[];
  @ApiProperty({ type: [String] }) statuses: string[];
  @ApiProperty({ enum: RULE_VIRTUAL_MODES, nullable: true })
  virtual: RuleVirtualMode | null;
}

/** The exclusions applied; rules in the order sent, one per rule sent. */
export class ServicesAppliedExclusionsDto {
  @ApiProperty({ type: [String] }) serviceIds: string[];
  @ApiProperty({ type: [ServicesAppliedExclusionRuleDto] })
  rules: ServicesAppliedExclusionRuleDto[];
}

const APPLIED_EXCLUSIONS = {
  type: ServicesAppliedExclusionsDto,
  description:
    "The request's exclude, as applied. A Norse that predates exclusions ignores exclude and omits this, so a caller that excludes must refuse a response without it.",
};

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
  @ApiProperty() limit: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` for the next page; null on the last page.',
  })
  nextCursor: string | null;
  @ApiProperty(APPLIED_EXCLUSIONS)
  appliedExclusions: ServicesAppliedExclusionsDto;
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
  @ApiProperty(APPLIED_EXCLUSIONS)
  appliedExclusions: ServicesAppliedExclusionsDto;
}

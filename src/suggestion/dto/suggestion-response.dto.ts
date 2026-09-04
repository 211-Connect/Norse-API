import { ApiProperty } from '@nestjs/swagger';
import { TaxonomyItemDto } from 'src/taxonomy/dto/taxonomy-response.dto';

/**
 * Flat organization typeahead item returned under `GET /suggestion`'s
 * `organizations` key. Deliberately slimmer than `OrganizationSearchHitDto`
 * (no `_index`/`_id`/`_score` ES wrapper, no nested `location` object) since
 * this is a same-round-trip convenience payload, not a paginated search
 * result. Unlike `TaxonomyItemDto`, there's no existing minimal DTO in
 * `organization/dto/` to reuse here — `/organization` only ever returns the
 * full ES hit shape (`OrganizationSearchSourceDto`), so this is the first
 * definition of the flat shape, not a duplicate of one.
 */
export class OrganizationSuggestionItemDto {
  @ApiProperty() organization_id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) city: string | null;
  @ApiProperty({ nullable: true }) state: string | null;
}

/**
 * `GET /suggestion`'s response shape. Always includes both keys — this
 * endpoint's entire purpose is to return taxonomy and organization
 * typeahead matches in a single round trip; use `GET /taxonomy` directly
 * if the full taxonomy search result (pagination, raw ES fields) is needed.
 *
 * `taxonomies` reuses `TaxonomyItemDto` from `src/taxonomy/dto/taxonomy-response.dto.ts`
 * (the same DTO `GET /taxonomy` v2 already returns) rather than redefining
 * an identical shape here.
 */
export class SuggestionCombinedResponseDto {
  @ApiProperty({ type: [TaxonomyItemDto] })
  taxonomies: TaxonomyItemDto[];

  @ApiProperty({ type: [OrganizationSuggestionItemDto] })
  organizations: OrganizationSuggestionItemDto[];
}

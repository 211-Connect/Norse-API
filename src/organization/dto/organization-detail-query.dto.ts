import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Related entities that can be sideloaded onto an organization-detail response
 * via `?include=`. Follows the JSON:API `include` convention: the primary org
 * keeps its references (SAL IDs) and the hydrated entities are returned in a
 * separate `included` block.
 */
export enum OrganizationInclude {
  RESOURCES = 'resources',
}

/**
 * Splits a comma-delimited `?include=a,b` value (or a repeated `?include=a&include=b`)
 * into a de-duplicated array, dropping blanks.
 */
const toIncludeArray = ({
  value,
}: {
  value: unknown;
}): OrganizationInclude[] => {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = raw.map((v) => String(v).trim()).filter((v) => v.length > 0);
  return [...new Set(cleaned)] as OrganizationInclude[];
};

export class OrganizationDetailQueryDto {
  /**
   * Comma-delimited list of related entities to sideload. Currently only
   * `resources` is supported, which hydrates every service-at-location ID on
   * the org into a full resource document.
   */
  @IsOptional()
  @Transform(toIncludeArray)
  @IsEnum(OrganizationInclude, {
    each: true,
    message: `include must be one of: ${Object.values(OrganizationInclude).join(', ')}`,
  })
  include?: OrganizationInclude[];
}

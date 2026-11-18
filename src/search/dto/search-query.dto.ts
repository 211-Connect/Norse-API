import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SEARCH_QUERY_TYPES, SearchQueryType } from './search-query-type';
import { IsWithinMaxResultWindowConstraint } from 'src/common/dto/es-result-window.validator';
import {
  RELEVANCE_CUTOFF_VALUES,
  RelevanceCutoffValue,
} from '../internal/relevance-cutoff/types';
import {
  MAX_QUERY_LENGTH,
  QUERY_TOO_LONG_MESSAGE,
} from '../internal/query-log';
import { REGION_ID_PATTERN, regionIdMessage } from 'src/region/internal';
import {
  AREA_MATCH_PARAM_DESCRIPTION,
  AREA_MATCH_VALUES,
  AreaMatch,
  UNLOCATED_PARAM_DESCRIPTION,
  UNLOCATED_VALUES,
  Unlocated,
  MAX_REGION_IDS,
  REGION_PARAM_DESCRIPTION,
} from '../internal/area/area-match';

/** `a,b` or repeated `?region=a&region=b` → unique trimmed ids, or undefined. */
export function toRegionIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const ids = (Array.isArray(value) ? value : [value])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');
  return ids.length ? Array.from(new Set(ids)) : undefined;
}

/** `true`/`false` from a query string; anything else is left to fail validation. */
export function toBoolean(value: unknown): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

interface ComplexQuery {
  OR?: (string | ComplexQuery)[];
  AND?: (string | ComplexQuery)[];
}

const MAX_COMPLEX_QUERY_DEPTH = 5;

const isComplexNode = (value: unknown, depth = 0): value is ComplexQuery => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    depth > MAX_COMPLEX_QUERY_DEPTH
  ) {
    return false;
  }

  const node = value as Record<string, unknown>;
  const keys = Object.keys(node);
  if (keys.length === 0 || keys.some((key) => key !== 'OR' && key !== 'AND')) {
    return false;
  }

  const hasOr = Array.isArray(node.OR);
  const hasAnd = Array.isArray(node.AND);
  if (!hasOr && !hasAnd) {
    return false;
  }

  const validateArray = (entry: unknown): boolean =>
    Array.isArray(entry) &&
    entry.every((item) => {
      if (typeof item === 'string') {
        return true;
      }

      return isComplexNode(item, depth + 1);
    });

  return (
    (!hasOr || validateArray(node.OR)) && (!hasAnd || validateArray(node.AND))
  );
};

@ValidatorConstraint({ name: 'isSearchQueryExpression', async: false })
class IsSearchQueryExpressionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value === 'string') {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every((entry) => typeof entry === 'string');
    }

    return isComplexNode(value);
  }

  defaultMessage(): string {
    return 'query must be a string, string array, or valid nested AND/OR object';
  }
}

/** Max length (UTF-16 units, as Elasticsearch counts; class-validator's `@MaxLength` counts code points) for a `query` that may also be an array or an AND/OR object: only a string is measured. */
@ValidatorConstraint({ name: 'isQueryWithinMaxLength', async: false })
class IsQueryWithinMaxLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value !== 'string' || value.length <= MAX_QUERY_LENGTH;
  }

  defaultMessage(): string {
    return QUERY_TOO_LONG_MESSAGE;
  }
}

/** Shared with `SearchQueryApiDto`, which documents the same param. */
export const ORGANIZATION_ID_DESCRIPTION =
  'Scope results to resources belonging to a single organization, by its ' +
  'stable organization id (the `organization_id` returned by /suggestion and ' +
  '/organization). Composes with any query_type and with filters.';

export class SearchResourcesQueryDto {
  @ApiPropertyOptional({
    description:
      'Search query expression. Can be plain text, string array, or nested AND/OR object payload.',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', additionalProperties: true },
    ],
    default: '',
  })
  @IsOptional()
  @Validate(IsSearchQueryExpressionConstraint)
  @Validate(IsQueryWithinMaxLengthConstraint)
  query: string | string[] | ComplexQuery = '';

  @ApiPropertyOptional({
    enum: SEARCH_QUERY_TYPES,
    default: 'text',
  })
  @IsOptional()
  @IsEnum(SEARCH_QUERY_TYPES)
  query_type: SearchQueryType = 'text';

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description:
      'Result offset must stay within Elasticsearch max_result_window: ' +
      'page * limit may not exceed 10000 (ES can only return the first ' +
      '10000 hits), e.g. with the default limit of 25 the highest page is 400.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Validate(IsWithinMaxResultWindowConstraint)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Comma-delimited longitude,latitude',
    example: '-120.740135,47.751076',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const parts = value.split(',');
      if (parts.length !== 2) {
        return undefined;
      }

      const numbers = parts.map((part) => Number.parseFloat(part));
      if (numbers.some(Number.isNaN)) {
        return undefined;
      }

      return numbers;
    }

    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((v) => typeof v === 'number')
    ) {
      return value;
    }

    return undefined;
  })
  coords?: [number, number];

  @ApiPropertyOptional({
    description: REGION_PARAM_DESCRIPTION,
    type: String,
    example: 'county:53077',
  })
  @IsOptional()
  @Transform(({ value }) => toRegionIds(value))
  @IsArray()
  @ArrayMaxSize(MAX_REGION_IDS)
  @IsString({ each: true })
  @Matches(REGION_ID_PATTERN, { each: true, message: regionIdMessage })
  region?: string[];

  @ApiPropertyOptional({
    description: AREA_MATCH_PARAM_DESCRIPTION,
    enum: AREA_MATCH_VALUES,
  })
  @IsOptional()
  @IsIn(AREA_MATCH_VALUES)
  area_match?: AreaMatch;

  @ApiPropertyOptional({
    description: UNLOCATED_PARAM_DESCRIPTION,
    enum: UNLOCATED_VALUES,
  })
  @IsOptional()
  @IsIn(UNLOCATED_VALUES)
  unlocated?: Unlocated;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    default: {},
  })
  @IsOptional()
  @IsObject()
  filters: Record<string, string | string[]> = {};

  @ApiPropertyOptional({
    description: ORGANIZATION_ID_DESCRIPTION,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization_id?: string;

  @ApiPropertyOptional({
    description: 'HSIS taxonomy scope as comma-delimited string or array',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    default: [],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return [];
    }

    const raw = Array.isArray(value)
      ? value
      : String(value)
          .replace(/^\s*\[/, '')
          .replace(/\]\s*$/, '')
          .split(',');

    return Array.from(
      new Set(
        raw
          .map((code) =>
            String(code)
              .trim()
              .replace(/^["']+|["']+$/g, '')
              .trim(),
          )
          .filter(Boolean),
      ),
    );
  })
  @IsArray()
  @IsString({ each: true })
  taxonomy: string[] = [];

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  distance: number = 0;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  age?: number;

  @ApiPropertyOptional({ minimum: 25, maximum: 300, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(25)
  @Max(300)
  limit: number = 25;

  @ApiPropertyOptional({
    enum: ['boundary', 'proximity'],
    description:
      'distance 0 (the default) means no radius filter. ' +
      'Omitted (default): service_area containment AND distance both required ' +
      '(a result with no map point skips the distance check). ' +
      "'proximity': a result with a map point needs distance only; a result with no map " +
      'point needs a service_area containing coords. ' +
      "'boundary': ignores coords/distance, matches service_area against a POST body geometry.",
  })
  @IsOptional()
  @IsEnum(['boundary', 'proximity'])
  geo_type?: 'boundary' | 'proximity';

  @ApiPropertyOptional({
    enum: ['relevance', 'distance', 'name', 'organization'],
    default: 'relevance',
  })
  @IsOptional()
  @IsEnum(['relevance', 'distance', 'name', 'organization'])
  sort: 'relevance' | 'distance' | 'name' | 'organization' = 'relevance';

  @ApiPropertyOptional({
    enum: RELEVANCE_CUTOFF_VALUES,
    default: 'off',
    description:
      'Opt-in trimming of low-relevance results. `off` (default) returns the ' +
      'full matched set, byte-identical to previous behaviour. `on` keeps ' +
      'results scoring at least a fraction of the top score — 0.2 of the top, ' +
      'tightened stepwise (up to 0.5) when more than 1,000 results would ' +
      'survive, and never less than the top-20 results own scores — and ' +
      'returns everything when the scores are too flat for that to remove ' +
      'anything ' +
      'meaningful — a uniformly weak result set is reported as such rather ' +
      'than cut arbitrarily. The cut is computed on semantic and lexical ' +
      'relevance only: proximity still filters and ranks, but never decides ' +
      'what is irrelevant. Hybrid search only (`query_type=hybrid`); ignored ' +
      'for other query types. When a cutoff applies, `hits.total` reports the ' +
      'kept count and the original is preserved in ' +
      '`relevance_cutoff.matched_before_cutoff`.',
  })
  @IsOptional()
  @IsEnum(RELEVANCE_CUTOFF_VALUES)
  relevance_cutoff?: RelevanceCutoffValue = 'off';
}

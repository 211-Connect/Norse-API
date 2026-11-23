import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  Max,
  Min,
  IsOptional,
  IsString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  IsQueryWithinMaxLengthConstraint,
  SearchResourcesQueryDto,
} from '../../../search/dto/search-query.dto';
import {
  RELEVANCE_CUTOFF_VALUES,
  RelevanceCutoffValue,
} from '../../../search/internal/relevance-cutoff/types';
import { MAX_QUERY_LENGTH } from '../../../search/internal/query-log';
import { NX, isKnownCode, isTier1, isTier2 } from '../../rules/sune';

export const V2_URGENCY_CODES = [
  'U-0',
  'U-1',
  'U-2',
  'U-3',
  'U-4',
  'U-X',
] as const;
export const V2_CLARIFY_VALUES = ['auto', 'never'] as const;

/** Codes that are neither SUNE Tier 1, Tier 2 nor N-X, in request order. */
function unknownCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === 'string' && !isKnownCode(v),
  );
}

/** `"lon,lat"` to `[lon, lat]`; anything else is left as is for the validator. */
export function toCoords(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some((p) => p.trim() === '')) return value;
  return parts.map((p) => Number(p));
}

@ValidatorConstraint({ name: 'isCoords', async: false })
class CoordsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [lon, lat] = value as unknown[];
    return (
      typeof lon === 'number' &&
      typeof lat === 'number' &&
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      lon >= -180 &&
      lon <= 180 &&
      lat >= -90 &&
      lat <= 90
    );
  }
  defaultMessage(): string {
    return 'coords must be longitude,latitude with longitude -180 to 180 and latitude -90 to 90';
  }
}

@ValidatorConstraint({ name: 'isSelectableNeedCode', async: false })
class IsSelectableNeedCodeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every((v) => typeof v === 'string' && (isTier1(v) || isTier2(v)))
    );
  }
  defaultMessage(args: ValidationArguments): string {
    const unknown = unknownCodes(args.value);
    const parts = [
      ...(unknown.length > 0
        ? [`unknown need code(s): ${unknown.join(', ')}`]
        : []),
      ...(Array.isArray(args.value) && args.value.includes(NX)
        ? ['N-X ("need not yet known") is internal and not accepted']
        : []),
    ];
    return [
      '$property must hold only SUNE Tier 1 or Tier 2 need codes',
      ...parts,
    ].join('; ');
  }
}

/**
 * `needs=A&needs=B` and `needs=A,B` (and a mix) become one ordered, de-duplicated
 * array. Non-string input is left as is, so the validators reject it.
 */
export function toCodeList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  if (!raw.every((v) => typeof v === 'string')) return value;
  const codes = (raw as string[])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(codes));
}

/**
 * Query of `GET /v2/search`: the v1 search parameters (location, paging, sort,
 * cutoff, filters) minus `query_type` (v2 always runs hybrid), plus the v2-only
 * fields. Draft until the v2 ADR (ISS-2493).
 */
export class V2SearchQueryDto extends OmitType(SearchResourcesQueryDto, [
  'query_type',
  'query',
  'coords',
] as const) {
  // v1 drops a malformed coords value and passes any number through, so
  // `Infinity,0` was a 500 and `200,100` searched an impossible point (break
  // run 2026-11-14). v2 keeps the v1 format and rejects the rest with a 400.
  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-delimited longitude,latitude. Longitude -180 to 180, latitude -90 to 90. Anything else is a 400.',
    example: '-120.740135,47.751076',
  })
  @IsOptional()
  @Transform(({ value }) => toCoords(value))
  @Validate(CoordsConstraint)
  coords?: [number, number];

  // v1 keeps @Min(25); v2 takes 1 to 300 (Lucas 2026-11-17).
  @ApiPropertyOptional({ minimum: 1, maximum: 300, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  limit: number = 25;

  // Off by default in v2 until a dev Tempo trace shows the cost (Lucas
  // 2026-11-19, final); `on` turns it on. The service leaves it off for an
  // empty query (browse).
  @ApiPropertyOptional({
    enum: RELEVANCE_CUTOFF_VALUES,
    default: 'off',
    description:
      'Trims low-relevance results. `off` by default; `on` trims when there is query text. Empty query: always off. See v1 for the rule.',
  })
  @IsOptional()
  @IsEnum(RELEVANCE_CUTOFF_VALUES)
  relevance_cutoff?: RelevanceCutoffValue = 'off';

  // v1 also takes a string array or an AND/OR object. v2 has no use for them:
  // they reached the search as "food,rent" or "[object Object]" (break run
  // 2026-11-14). ADR 0039 OpenAPI draft types query as a string.
  @ApiPropertyOptional({
    type: String,
    default: '',
    maxLength: MAX_QUERY_LENGTH,
    description:
      'Free text. A repeated parameter or an AND/OR object is a 400.',
  })
  @IsOptional()
  @IsString({
    message: 'query must be a string (one query parameter, plain text)',
  })
  // The v1 rule, one place (David, PR #278 and #279 reviews): 500 UTF-16
  // units, as Elasticsearch counts (an emoji is 2); Elasticsearch rejects a
  // prefix query over 1000 characters, and a cap keeps a pasted transcript out
  // of the logs and the embedding call. Classify still cuts to 512.
  @Validate(IsQueryWithinMaxLengthConstraint)
  query: string = '';

  @ApiPropertyOptional({
    type: [String],
    description:
      'Confirmed need codes. Repeat the parameter (`needs=A&needs=B`) or send a ' +
      'comma-separated list (`needs=A,B`). They never filter. They boost results and order them in blocks: services with every sent need first, then services with some, then the rest.',
    example: ['N-HOU-02'],
  })
  @IsOptional()
  @Transform(({ value }) => toCodeList(value))
  @IsArray()
  @Validate(IsSelectableNeedCodeConstraint)
  needs?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Need codes the caller already declined. They are never offered again. ' +
      'Same formats and codes as `needs`: an unknown code or N-X is a 400 that names it.',
  })
  @IsOptional()
  @Transform(({ value }) => toCodeList(value))
  @IsArray()
  @Validate(IsSelectableNeedCodeConstraint)
  passed_needs?: string[];

  @ApiPropertyOptional({
    enum: V2_URGENCY_CODES,
    description:
      'Urgency the caller confirmed. `U-X` means the time is not yet known and counts as absent. `U-1` to `U-4` hide the emergency card, also on a keyword floor hit.',
  })
  @IsOptional()
  @IsIn(V2_URGENCY_CODES)
  urgency?: (typeof V2_URGENCY_CODES)[number];

  @ApiPropertyOptional({
    enum: V2_CLARIFY_VALUES,
    default: 'auto',
    description:
      '`auto` returns clarification questions. `never` keeps only the emergency question.',
  })
  @IsOptional()
  @IsIn(V2_CLARIFY_VALUES)
  clarify: (typeof V2_CLARIFY_VALUES)[number] = 'auto';
}

import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SearchResourcesQueryDto } from '../../../search/dto/search-query.dto';
import { ASKED_QUESTION_IDS } from '../../rules/config';
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

@ValidatorConstraint({ name: 'isKnownNeedCode', async: false })
class IsKnownNeedCodeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every((v) => typeof v === 'string' && isKnownCode(v))
    );
  }
  defaultMessage(args: ValidationArguments): string {
    const unknown = unknownCodes(args.value);
    return [
      '$property must hold only known need codes (a SUNE Tier 1 or Tier 2 code, or N-X)',
      ...(unknown.length > 0
        ? [`unknown need code(s): ${unknown.join(', ')}`]
        : []),
    ].join('; ');
  }
}

@ValidatorConstraint({ name: 'isAskedQuestionId', async: false })
class IsAskedQuestionIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every(
        (v) => typeof v === 'string' && ASKED_QUESTION_IDS.includes(v),
      )
    );
  }
  defaultMessage(args: ValidationArguments): string {
    const unknown = Array.isArray(args.value)
      ? args.value.filter((v) => !ASKED_QUESTION_IDS.includes(v as string))
      : [];
    return [
      `$property must hold only known question ids (${ASKED_QUESTION_IDS.join(', ')})`,
      ...(unknown.length > 0
        ? [`unknown question id(s): ${unknown.join(', ')}`]
        : []),
    ].join('; ');
  }
}

/**
 * Query of `GET /v2/search`: the v1 search parameters (location, paging, sort,
 * cutoff, filters) minus `query_type` (v2 always runs hybrid), plus the v2-only
 * fields. Draft until the v2 ADR (ISS-2493).
 */
export class V2SearchQueryDto extends OmitType(SearchResourcesQueryDto, [
  'query_type',
] as const) {
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
      'Same formats as `needs`.',
  })
  @IsOptional()
  @Transform(({ value }) => toCodeList(value))
  @IsArray()
  @Validate(IsKnownNeedCodeConstraint)
  passed_needs?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Question ids answered without a value. `asked=emergency` means the emergency ' +
      'question was answered "No, I am safe now": it is not asked again, and an ' +
      'urgency question comes next. Same list formats as `needs`. Draft mark, not ' +
      'confirmed (ISS-2499).',
    example: ['emergency'],
  })
  @IsOptional()
  @Transform(({ value }) => toCodeList(value))
  @IsArray()
  @Validate(IsAskedQuestionIdConstraint)
  asked?: string[];

  @ApiPropertyOptional({
    enum: V2_URGENCY_CODES,
    description:
      'Urgency the caller confirmed. `U-X` means not yet known and counts as absent.',
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

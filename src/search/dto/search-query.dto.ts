import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

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
class IsSearchQueryExpressionConstraint
  implements ValidatorConstraintInterface
{
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
  query: string | string[] | ComplexQuery = '';

  @ApiPropertyOptional({
    enum: ['text', 'taxonomy', 'organization', 'more_like_this', 'hybrid'],
    default: 'text',
  })
  @IsOptional()
  @IsEnum(['text', 'taxonomy', 'organization', 'more_like_this', 'hybrid'])
  query_type:
    | 'text'
    | 'taxonomy'
    | 'organization'
    | 'more_like_this'
    | 'hybrid' = 'text';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
    type: 'object',
    additionalProperties: true,
    default: {},
  })
  @IsOptional()
  @IsObject()
  filters: Record<string, string | string[]> = {};

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

  @ApiPropertyOptional({ enum: ['boundary', 'proximity'] })
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
}

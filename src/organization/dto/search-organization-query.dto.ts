import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { IsWithinMaxResultWindowConstraint } from 'src/common/dto/es-result-window.validator';

export class SearchOrganizationQueryDto {
  @IsString()
  @IsOptional()
  query: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Validate(IsWithinMaxResultWindowConstraint)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

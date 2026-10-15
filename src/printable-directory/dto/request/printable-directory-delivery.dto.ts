import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES,
  PRINTABLE_DIRECTORY_DELIVERY_MAX_MONTH_DAY,
  PRINTABLE_DIRECTORY_DELIVERY_MAX_RECIPIENTS,
  PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES,
  PRINTABLE_DIRECTORY_PRINT_FONT_SIZES,
  PRINTABLE_DIRECTORY_PRINT_VARIANTS,
  PrintableDirectoryDeliveryFrequency,
  PrintableDirectoryDeliveryRunStatus,
  PrintableDirectoryPrintFontSize,
  PrintableDirectoryPrintVariant,
} from 'src/common/schemas/printable-directory-delivery.schema';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PrintableDirectoryDeliveryPrintOptionsDto {
  @ApiProperty({
    example: 'en',
    description: "One of the directory's languages.",
  })
  @IsString()
  @MaxLength(32)
  locale: string;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_PRINT_VARIANTS })
  @IsIn(PRINTABLE_DIRECTORY_PRINT_VARIANTS)
  variant: PrintableDirectoryPrintVariant;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_PRINT_FONT_SIZES })
  @IsIn(PRINTABLE_DIRECTORY_PRINT_FONT_SIZES)
  fontSize: PrintableDirectoryPrintFontSize;

  @ApiProperty()
  @IsBoolean()
  booklet: boolean;
}

export class CreatePrintableDirectoryDeliveryDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES })
  @IsIn(PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES)
  frequency: PrintableDirectoryDeliveryFrequency;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Days of the week, 0 (Sunday) to 6 (Saturday). Required when weekly.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: `Days of the month, 1 to ${PRINTABLE_DIRECTORY_DELIVERY_MAX_MONTH_DAY}. Required when monthly.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRINTABLE_DIRECTORY_DELIVERY_MAX_MONTH_DAY)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(PRINTABLE_DIRECTORY_DELIVERY_MAX_MONTH_DAY, { each: true })
  monthDays?: number[];

  @ApiProperty({ type: PrintableDirectoryDeliveryPrintOptionsDto })
  @ValidateNested()
  @Type(() => PrintableDirectoryDeliveryPrintOptionsDto)
  print: PrintableDirectoryDeliveryPrintOptionsDto;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: PRINTABLE_DIRECTORY_DELIVERY_MAX_RECIPIENTS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINTABLE_DIRECTORY_DELIVERY_MAX_RECIPIENTS)
  @IsEmail({}, { each: true })
  recipients: string[];
}

export class UpdatePrintableDirectoryDeliveryDto extends PartialType(
  CreatePrintableDirectoryDeliveryDto,
) {}

export class DuePrintableDirectoryDeliveriesQueryDto {
  @ApiProperty({
    example: '2026-10-14',
    description: 'Calendar date (America/New_York) of the run.',
  })
  @Matches(DATE_PATTERN)
  date: string;
}

export class ClaimPrintableDirectoryDeliveryDto {
  @ApiProperty({ example: '2026-10-14' })
  @Matches(DATE_PATTERN)
  date: string;
}

export class ReportPrintableDirectoryDeliveryResultDto {
  @ApiProperty({ example: '2026-10-14' })
  @Matches(DATE_PATTERN)
  date: string;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES })
  @IsIn(PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES)
  status: PrintableDirectoryDeliveryRunStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

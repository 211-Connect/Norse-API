import { ApiProperty } from '@nestjs/swagger';
import {
  PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES,
  PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES,
  PrintableDirectoryDeliveryFrequency,
  PrintableDirectoryDeliveryRunStatus,
} from 'src/common/schemas/printable-directory-delivery.schema';
import { PrintableDirectoryDeliveryPrintOptionsDto } from '../request/printable-directory-delivery.dto';

export class PrintableDirectoryDeliveryLastRunResponseDto {
  @ApiProperty({ example: '2026-10-14' })
  date: string;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES })
  status: PrintableDirectoryDeliveryRunStatus;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty()
  at: string;
}

export class PrintableDirectoryDeliveryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  directoryId: string;

  @ApiProperty()
  createdByEmail: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES })
  frequency: PrintableDirectoryDeliveryFrequency;

  @ApiProperty({ type: [Number] })
  weekdays: number[];

  @ApiProperty({ type: [Number] })
  monthDays: number[];

  @ApiProperty({ type: PrintableDirectoryDeliveryPrintOptionsDto })
  print: PrintableDirectoryDeliveryPrintOptionsDto;

  @ApiProperty({ type: [String] })
  recipients: string[];

  @ApiProperty({
    type: PrintableDirectoryDeliveryLastRunResponseDto,
    nullable: true,
  })
  lastRun: PrintableDirectoryDeliveryLastRunResponseDto | null;

  @ApiProperty({ required: false })
  createdAt?: string;

  @ApiProperty({ required: false })
  updatedAt?: string;
}

export class PrintableDirectoryDeliveryListResponseDto {
  @ApiProperty({ type: [PrintableDirectoryDeliveryResponseDto] })
  items: PrintableDirectoryDeliveryResponseDto[];
}

export class DuePrintableDirectoryDeliveryDirectoryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Public share slug; null when the directory has none.',
  })
  slug: string | null;

  @ApiProperty()
  primaryLanguage: string;

  @ApiProperty({ type: [String] })
  locales: string[];
}

export class DuePrintableDirectoryDeliveryResponseDto extends PrintableDirectoryDeliveryResponseDto {
  @ApiProperty({ type: DuePrintableDirectoryDeliveryDirectoryDto })
  directory: DuePrintableDirectoryDeliveryDirectoryDto;
}

export class DuePrintableDirectoryDeliveryListResponseDto {
  @ApiProperty({ type: [DuePrintableDirectoryDeliveryResponseDto] })
  items: DuePrintableDirectoryDeliveryResponseDto[];
}

export class ClaimPrintableDirectoryDeliveryResponseDto {
  @ApiProperty({
    description:
      'False when the delivery was already claimed for this date (another run handled it).',
  })
  claimed: boolean;
}

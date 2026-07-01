import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EventPayloadDto {
  @ApiProperty({
    description: 'Event name (1-255 characters)',
    example: 'resource_viewed',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Additional event data (key-value pairs)',
    example: { resourceId: '123', resourceType: 'library' },
    required: false,
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiProperty({
    description: 'ISO-8601 timestamp',
    example: '2024-06-26T15:00:00.000Z',
    required: true,
  })
  @IsString()
  @IsISO8601(
    { strict: true },
    { message: 'timestamp must be a valid ISO-8601 timestamp' },
  )
  timestamp: string;
}

export class SendEventDto {
  @ApiProperty({
    description: 'Umami website ID (UUID v4)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  websiteId: string;

  @ApiProperty({
    description: 'Event payload',
    type: EventPayloadDto,
  })
  @ValidateNested()
  @Type(() => EventPayloadDto)
  payload: EventPayloadDto;
}

export class SendBatchDto {
  @ApiProperty({
    description: 'Array of events to send (max 100)',
    type: [SendEventDto],
  })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SendEventDto)
  events: SendEventDto[];
}

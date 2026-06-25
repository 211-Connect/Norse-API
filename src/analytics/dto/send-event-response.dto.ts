import { ApiProperty } from '@nestjs/swagger';

export class SendEventResponseDto {
  @ApiProperty({
    description: 'Whether the event was sent successfully',
    example: true,
  })
  success: boolean;
}

export class SendBatchResponseDto {
  @ApiProperty({
    description: 'Whether all events were sent successfully',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Number of events processed',
    example: 10,
  })
  processed: number;

  @ApiProperty({
    description: 'Number of events that failed',
    example: 0,
  })
  errors: number;

  @ApiProperty({
    description: 'Details of failed events',
    example: [],
    type: 'array',
    items: {
      type: 'object',
      properties: {
        index: { type: 'number' },
        error: { type: 'string' },
      },
    },
  })
  details: Array<{ index: number; error: string }>;
}

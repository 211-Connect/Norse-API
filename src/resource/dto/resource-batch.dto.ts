import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  ResourceBatchError,
  ResourceBatchMeta,
  ResourceBatchResponse,
  TransformedResource,
} from '../types/resource-response.types';
import { RESOURCE_EXAMPLE } from './resource-examples';
import { TransformedResourceDto } from './resource-response.dto';
import { ResourceIdsDto } from './resource-ids.dto';

export class ResourceBatchDto extends ResourceIdsDto {}

export class ResourceBatchErrorDto implements ResourceBatchError {
  @ApiProperty({
    description: 'The resource ID that failed',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Error reason',
    example: 'Resource not found',
  })
  reason: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 404,
  })
  statusCode: number;
}

export class ResourceBatchResponseDto implements ResourceBatchResponse {
  @ApiProperty({
    description: 'Successfully fetched resources, keyed by resource ID',
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(TransformedResourceDto),
    },
    example: {
      '550e8400-e29b-41d4-a716-446655440000': RESOURCE_EXAMPLE,
    },
  })
  data: Record<string, TransformedResource>;

  @ApiProperty({
    description: 'Failed resource IDs with error details',
    type: [ResourceBatchErrorDto],
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        reason: 'Resource not found',
        statusCode: 404,
      },
    ],
  })
  errors: ResourceBatchErrorDto[];

  @ApiProperty({
    description: 'Metadata about the batch operation',
    example: {
      requested: 2,
      successful: 1,
      failed: 1,
    },
  })
  meta: ResourceBatchMeta;
}

import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import {
  ResourceBatchMeta,
  TransformedResourceMap,
} from '../types/resource-response.types';
import { TransformedResourceOpenApiDto } from './transformed-resource.openapi.dto';

export class ResourceBatchDto {
  @ApiProperty({
    description: 'Array of resource UUIDs to fetch',
    type: [String],
    minItems: 1,
    maxItems: 100,
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 ID is required' })
  @ArrayMaxSize(100, { message: 'No more than 100 IDs are allowed' })
  @IsUUID(undefined, { each: true, message: 'Each ID must be a valid UUID' })
  ids: string[];
}

export class ResourceBatchErrorDto {
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

export class ResourceBatchMetaDto implements ResourceBatchMeta {
  @ApiProperty({ description: 'Requested IDs count', example: 2 })
  requested: number;

  @ApiProperty({
    description: 'Successfully resolved resources count',
    example: 1,
  })
  successful: number;

  @ApiProperty({ description: 'Failed IDs count', example: 1 })
  failed: number;
}

export class ResourceBatchResponseDto {
  @ApiProperty({
    description: 'Successfully fetched resources, keyed by resource ID',
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(TransformedResourceOpenApiDto),
    },
    example: {
      '550e8400-e29b-41d4-a716-446655440000': {
        _id: '550e8400-e29b-41d4-a716-446655440000',
        displayName: 'Example Resource',
        // ... other fields
      },
    },
  })
  data: TransformedResourceMap;

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
    type: ResourceBatchMetaDto,
  })
  meta: ResourceBatchMetaDto;
}

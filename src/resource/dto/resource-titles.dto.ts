import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ResourceTitlesDto {
  @ApiProperty({
    description: 'Array of resource UUIDs',
    type: [String],
    minItems: 1,
    maxItems: 100,
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 ID is required' })
  @ArrayMaxSize(100, { message: 'No more than 100 IDs are allowed' })
  @IsUUID(undefined, { each: true, message: 'Each ID must be a valid UUID' })
  ids: string[];
}

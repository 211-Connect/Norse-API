import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SyncFavoriteListDto {
  @ApiProperty({
    type: [String],
    example: ['resource-1', 'resource-2'],
    description:
      'Resource IDs stored locally that should be matched against the authenticated user favorite lists.',
  })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  resourceIds: string[];
}

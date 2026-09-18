import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class PermissionsResponseDto {
  @ApiProperty({ description: 'Key identifier' })
  @IsString()
  keyId: string;

  @ApiProperty({ description: 'Permission slugs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @ApiProperty({
    description: 'Unix timestamp when the permissions were fetched',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  fetchedAt?: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderPrintableDirectorySourcesDto {
  @ApiProperty({ type: [String], description: 'Ordered source IDs' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  sourceIds: string[];
}

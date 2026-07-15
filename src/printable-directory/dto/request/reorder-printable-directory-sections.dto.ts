import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderPrintableDirectorySectionsDto {
  @ApiProperty({ type: [String], description: 'Ordered section IDs' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  sectionIds: string[];
}

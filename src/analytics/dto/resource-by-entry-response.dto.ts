import { ApiProperty } from '@nestjs/swagger';
import type { ResourceByEntry } from '../types';

export class ResourceByEntryResponse implements ResourceByEntry {
  @ApiProperty({
    description: 'Entry page path from which the resource was viewed',
    example: '/search?query_label=food',
  })
  entry: string;

  @ApiProperty({
    description: 'Number of resource views originating from this entry page',
    example: 73,
  })
  count: number;
}

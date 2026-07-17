import { ApiProperty } from '@nestjs/swagger';
import type { EventCatalogEntry } from '../types';

export class EventCatalogEntryResponse implements EventCatalogEntry {
  @ApiProperty({
    description: 'Umami event name',
    example: 'search_zero_results',
  })
  eventName: string;

  @ApiProperty({
    description: 'Available property names for this event',
    example: ['query', 'queryLabel', 'userCoordinates'],
    type: [String],
  })
  properties: string[];
}

import { ApiProperty } from '@nestjs/swagger';
import type { SearchHits as ISearchHits, Searches } from '../types';

class SearchHits implements ISearchHits {
  @ApiProperty({
    description: 'Search query string',
    example: 'example search query',
  })
  query: string;
  @ApiProperty({
    description: 'Number of matching search events for the query',
    example: 42,
  })
  hits: number;
}

export class SearchesResponse implements Searches {
  @ApiProperty({
    description: 'Query labels and counts for text search events',
    type: [SearchHits],
  })
  text: SearchHits[];
  @ApiProperty({
    description: 'Query labels and counts for taxonomy search events',
    type: [SearchHits],
  })
  taxonomy: SearchHits[];
  @ApiProperty({
    description: 'Query labels and counts for hybrid search events',
    type: [SearchHits],
  })
  hybrid: SearchHits[];
}

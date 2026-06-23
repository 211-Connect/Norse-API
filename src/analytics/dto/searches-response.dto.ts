import { ApiProperty } from '@nestjs/swagger';
import type { SearchHits as ISearchHits, Searches } from '../types';

class SearchHits implements ISearchHits {
  @ApiProperty({
    description: 'Search query string',
    example: 'example search query',
  })
  query: string;
  @ApiProperty({
    description: 'Number of hits for the search query',
    example: 42,
  })
  hits: number;
}

export class SearchesResponse implements Searches {
  @ApiProperty({
    description: 'Search queries and their hit counts for text searches',
    type: [SearchHits],
  })
  text: SearchHits[];
  @ApiProperty({
    description: 'Search queries and their hit counts for taxonomy searches',
    type: [SearchHits],
  })
  taxonomy: SearchHits[];
  @ApiProperty({
    description: 'Search queries and their hit counts for hybrid searches',
    type: [SearchHits],
  })
  hybrid: SearchHits[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SearchBodyApiDto,
  SearchQueryApiDto,
} from 'src/search/dto/search-query.api.dto';

export class PrintableDirectorySourceQueryResponseDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  title?: string | null;

  @ApiProperty({
    type: SearchQueryApiDto,
    description:
      'Serialized /search query parameters. Common keys include query_type, query, page, limit, filters, coords, distance, age, geo_type, taxonomy, and sort.',
    example: {
      query_type: 'text',
      query: 'housing',
      page: 1,
      limit: 25,
      coords: '-120.740135,47.751076',
      sort: 'relevance',
    },
  })
  params: SearchQueryApiDto;

  @ApiPropertyOptional({
    type: SearchBodyApiDto,
    nullable: true,
    description:
      'Optional serialized /search POST body. Used when query resolution requires geometry payload (for example polygon/bounding-box intersection or other GeoJSON-based filters).',
    example: {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-120.9, 47.6],
            [-120.6, 47.6],
            [-120.6, 47.8],
            [-120.9, 47.8],
            [-120.9, 47.6],
          ],
        ],
      },
    },
  })
  body?: SearchBodyApiDto | null;
}

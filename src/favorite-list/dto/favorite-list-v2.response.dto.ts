import { ApiProperty } from '@nestjs/swagger';

class FavoriteListHitSource {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  privacy: string;

  @ApiProperty()
  ownerId: string;
}

class FavoriteListHit {
  @ApiProperty()
  _index: string;

  @ApiProperty()
  _id: string;

  @ApiProperty()
  _score: number;

  @ApiProperty({ type: FavoriteListHitSource })
  _source: FavoriteListHitSource;
}

class ShardInfo {
  @ApiProperty()
  total: number;

  @ApiProperty()
  successful: number;

  @ApiProperty()
  skipped: number;

  @ApiProperty()
  failed: number;
}

class TotalHits {
  @ApiProperty()
  value: number;

  @ApiProperty()
  relation: string;
}

class FavoriteListHitsContainer {
  @ApiProperty({ type: TotalHits, example: { value: 100, relation: 'eq' } })
  total: TotalHits;

  @ApiProperty({ nullable: true })
  max_score: number | null;

  @ApiProperty({ type: [FavoriteListHit] })
  hits: FavoriteListHit[];
}

class SearchResponse {
  @ApiProperty()
  took: number;

  @ApiProperty()
  timed_out: boolean;

  @ApiProperty({ type: ShardInfo })
  _shards: ShardInfo;

  @ApiProperty({ type: FavoriteListHitsContainer })
  hits: FavoriteListHitsContainer;
}

export class FavoriteListV2ResponseDto {
  @ApiProperty({ type: SearchResponse })
  search: SearchResponse;
}

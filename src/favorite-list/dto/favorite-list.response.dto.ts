import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { TransformedResourceOpenApiDto } from 'src/resource/dto/transformed-resource.openapi.dto';
import { TransformedResource } from 'src/resource/types/resource-response.types';

export class FavoriteListItemDto {
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

  @ApiPropertyOptional({
    description:
      'Whether the list contains the specified resource (only present when resource_id is provided)',
  })
  containsResource?: boolean;
}

export class FavoriteListDetailResponseDto extends FavoriteListItemDto {
  @ApiProperty({
    type: [TransformedResourceOpenApiDto],
    description: 'Resolved favorite resources',
  })
  favorites: TransformedResource[];
}

export class FavoriteListResponseDto extends PaginationResponseDto {
  @ApiProperty({ type: [FavoriteListItemDto] })
  items: FavoriteListItemDto[];
}

export class FavoriteListSyncResponseDto extends FavoriteListItemDto {
  @ApiProperty({ type: [String] })
  favorites: string[];
}

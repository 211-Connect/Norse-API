import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { Resource } from '../../common/schemas/resource.schema';
import { FavoriteResourceOpenApiDto } from '../../resource/dto/transformed-resource.openapi.dto';

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
    type: [FavoriteResourceOpenApiDto],
    description: 'Populated favorites (resources)',
  })
  favorites: Omit<Resource, 'serviceArea'>[];
}

export class FavoriteListResponseDto extends PaginationResponseDto {
  @ApiProperty({ type: [FavoriteListItemDto] })
  items: FavoriteListItemDto[];
}

export class FavoriteListSyncResponseDto extends FavoriteListItemDto {
  @ApiProperty({ type: [String] })
  favorites: string[];
}

import { ApiProperty } from '@nestjs/swagger';
import { PaginationResponseDto } from '../../common/dto/pagination-response.dto';

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
}

export class FavoriteListDetailResponseDto extends FavoriteListItemDto {
  @ApiProperty({
    type: [Object],
    description: 'Populated favorites (resources)',
  })
  favorites: any[];
}

export class FavoriteListResponseDto extends PaginationResponseDto {
  @ApiProperty({ type: [FavoriteListItemDto] })
  items: FavoriteListItemDto[];
}

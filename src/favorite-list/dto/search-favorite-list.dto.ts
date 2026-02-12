import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchFavoriteListDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  exclude?: string;
}

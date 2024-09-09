import { PartialType } from '@nestjs/mapped-types';
import { CreateFavoriteListDto } from './create-favorite-list.dto';

export class UpdateFavoriteListDto extends PartialType(CreateFavoriteListDto) {
  name: string;
  description: string;
  public: boolean;
}

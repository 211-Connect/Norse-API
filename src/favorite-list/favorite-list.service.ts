import { Injectable } from '@nestjs/common';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';

@Injectable()
export class FavoriteListService {
  create(createFavoriteListDto: CreateFavoriteListDto) {
    return 'This action adds a new favoriteList';
  }

  findAll() {
    return `This action returns all favoriteList`;
  }

  findOne(id: number) {
    return `This action returns a #${id} favoriteList`;
  }

  update(id: number, updateFavoriteListDto: UpdateFavoriteListDto) {
    return `This action updates a #${id} favoriteList`;
  }

  remove(id: number) {
    return `This action removes a #${id} favoriteList`;
  }
}

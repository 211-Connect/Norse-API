import { ConflictException, Injectable } from '@nestjs/common';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { InjectModel } from '@nestjs/mongoose';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { Model } from 'mongoose';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectModel(FavoriteList.name)
    private favoriteListModel: Model<FavoriteList>,
  ) {}

  async create(createFavoriteDto: CreateFavoriteDto, options: { user: User }) {
    const favoriteList = await this.favoriteListModel.findOne({
      ownerId: options.user.id,
      _id: createFavoriteDto.favoriteListId,
    });

    if (!favoriteList)
      throw new Error('No favorite list found to add favorite to.');

    const favorites = favoriteList.favorites;
    const exists = favorites.find(
      (el) => el.toString() === createFavoriteDto.resourceId,
    );

    if (exists) {
      // Using 409 Conflict here because the resource already exists in the list
      throw new ConflictException();
    }

    if (!exists) {
      favoriteList.favorites.push(createFavoriteDto.resourceId);
    }

    const newList = await favoriteList.save();
    return newList;
  }

  async remove(options: {
    favoriteId: string;
    favoriteListId: string;
    user: User;
  }) {
    const favoriteList = await this.favoriteListModel.findOne({
      ownerId: options.user.id,
      _id: options.favoriteListId,
    });

    if (!favoriteList)
      throw new Error('No favorite list found to remove favorite from.');

    const favorites = favoriteList.favorites;
    const index = favorites.findIndex(
      (el) => el.toString() === options.favoriteId,
    );

    if (index > -1) {
      favoriteList.favorites.splice(index, 1);
    }

    const newList = await favoriteList.save();
    return newList;
  }
}

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { InjectModel } from '@nestjs/mongoose';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { Model } from 'mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Request } from 'express';
import { isAuthorized } from 'src/common/lib/utils';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';

@Injectable()
export class FavoriteListService {
  constructor(
    @InjectModel(FavoriteList.name)
    private favoriteListModel: Model<FavoriteList>,
  ) {}

  create(
    createFavoriteListDto: CreateFavoriteListDto,
    options: { user: User },
  ) {
    const newFavoriteList = new this.favoriteListModel({
      name: createFavoriteListDto.name,
      description: createFavoriteListDto.description,
      privacy: createFavoriteListDto.public ? 'PUBLIC' : 'PRIVATE',
      ownerId: options.user.id,
    });

    return newFavoriteList.save();
  }

  findAll(options: { user: User }) {
    return this.favoriteListModel
      .find({
        ownerId: options.user.id,
      })
      .select('name description privacy')
      .limit(20);
  }

  search(
    searchFavoriteListDto: SearchFavoriteListDto,
    options: { user: User },
  ) {
    const mongoQuery: any = {
      ownerId: options.user.id,
      favorites: { $nin: searchFavoriteListDto.exclude },
    };

    if (searchFavoriteListDto.name)
      mongoQuery.name = { $regex: searchFavoriteListDto.name, $options: 'i' };

    return this.favoriteListModel
      .find(mongoQuery)
      .select('name description privacy')
      .limit(20);
  }

  async findOne(
    id: string,
    options: { headers: HeadersDto; request: Request },
  ) {
    const favoriteList = await this.favoriteListModel.findById(id).populate({
      path: 'favorites',
      model: 'Resource',
      select: '-serviceArea',
      transform: (doc: any) => {
        if (!doc) return null;

        const translation = doc.translations.find(
          (el: any) => el.locale === options.headers['accept-language'],
        );

        doc.translations = [];

        if (translation) doc.translations.push(translation);

        return doc;
      },
    });

    if (!favoriteList) throw new NotFoundException();

    favoriteList.favorites = favoriteList.favorites.filter(
      (el: any) => el != null,
    );

    if (favoriteList.privacy === 'PRIVATE') {
      const authorized = await isAuthorized(options.request);

      if (!authorized || options.request.user.id !== favoriteList.ownerId)
        throw new UnauthorizedException();
    }

    return favoriteList;
  }

  update(
    id: string,
    updateFavoriteListDto: UpdateFavoriteListDto,
    options: { user: User },
  ) {
    return this.favoriteListModel.updateOne(
      {
        _id: id,
        ownerId: options.user.id,
      },
      {
        name: updateFavoriteListDto.name,
        description: updateFavoriteListDto.description,
        privacy: updateFavoriteListDto.public ? 'PUBLIC' : 'PRIVATE',
      },
    );
  }

  remove(id: string, options: { user: User }) {
    return this.favoriteListModel.deleteOne({
      _id: id,
      ownerId: options.user.id,
    });
  }
}

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
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

interface User {
  id: string;
}
@Injectable()
export class FavoriteListService {
  // Initialize the logger
  private readonly logger = new Logger(FavoriteListService.name);

  constructor(
    @InjectModel(FavoriteList.name)
    private favoriteListModel: Model<FavoriteList>,
  ) {}

  async create(
    createFavoriteListDto: CreateFavoriteListDto,
    options: { user: User },
  ) {
    this.logger.log(
      `Attempting to create favorite list for user: ${options.user.id}`,
    );

    const favoriteListData = {
      name: createFavoriteListDto.name,
      description: createFavoriteListDto.description,
      privacy: createFavoriteListDto.public ? 'PUBLIC' : 'PRIVATE',
      ownerId: options.user.id,
    };

    try {
      const newFavoriteList = new this.favoriteListModel(favoriteListData);
      this.logger.log(
        `New FavoriteList model instantiated. Attempting to save...`,
      );
      const savedList = await newFavoriteList.save();
      this.logger.log(
        `Favorite list created successfully with ID: ${savedList._id}`,
      );
      return savedList;
    } catch (error) {
      this.logger.error(
        `Error creating favorite list for user ${options.user.id}: ${error.message}`,
        error.stack,
      );
      // Re-throw the error so NestJS can handle it and return a 500
      throw error;
    }
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

    if (!favoriteList) {
      this.logger.warn(`Favorite list with ID: ${id} not found.`);
      throw new NotFoundException();
    }

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

  async update(
    id: string,
    updateFavoriteListDto: UpdateFavoriteListDto,
    options: { user: User },
  ) {
    this.logger.log(
      `Updating favorite list with ID: ${id} for user: ${options.user.id}`,
    );

    try {
      const result = await this.favoriteListModel.updateOne(
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

      if (result.matchedCount === 0) {
        this.logger.warn(
          `Favorite list with ID ${id} not found for user ${options.user.id} during update.`,
        );
        throw new NotFoundException(
          `Favorite list with ID ${id} not found or user not authorized.`,
        );
      }

      this.logger.log(
        `Favorite list ${id} updated successfully. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Error updating favorite list ${id} for user ${options.user.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async remove(id: string, options: { user: User }) {
    this.logger.log(
      `Removing favorite list with ID: ${id} for user: ${options.user.id}`,
    );
    try {
      const result = await this.favoriteListModel.deleteOne({
        _id: id,
        ownerId: options.user.id,
      });

      if (result.deletedCount === 0) {
        this.logger.warn(
          `Favorite list with ID ${id} not found for user ${options.user.id} during delete.`,
        );
        throw new NotFoundException(
          `Favorite list with ID ${id} not found or user not authorized.`,
        );
      }

      this.logger.log(`Favorite list ${id} removed successfully.`);

      return result;
    } catch (error) {
      this.logger.error(
        `Error removing favorite list ${id} for user ${options.user.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

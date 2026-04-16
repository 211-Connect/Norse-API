import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { InjectModel } from '@nestjs/mongoose';
import {
  FavoriteList,
  FavoriteListDocument,
} from 'src/common/schemas/favorite-list.schema';
import { ResourceDocument } from 'src/common/schemas/resource.schema';
import { Model, FilterQuery } from 'mongoose';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { PaginationDto } from './dto/pagination.dto';
import {
  FavoriteListResponseDto,
  FavoriteListDetailResponseDto,
  FavoriteListItemDto,
} from './dto/favorite-list.response.dto';

interface User {
  id: string;
}
@Injectable()
export class FavoriteListService {
  private readonly logger = new Logger(FavoriteListService.name);

  constructor(
    @InjectModel(FavoriteList.name)
    private favoriteListModel: Model<FavoriteList>,
  ) {}

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

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

  async findAll(
    pagination: PaginationDto,
    options: { user: User },
  ): Promise<FavoriteListResponseDto> {
    if (pagination.search) {
      return this.search({ name: pagination.search }, pagination, options);
    }

    const { page, limit, resource_id } = pagination;
    const skip = (page - 1) * limit;

    const query = { ownerId: options.user.id };

    const selectFields = `name description privacy ownerId ${resource_id ? 'favorites' : ''}`;

    const [data, total] = await Promise.all([
      this.favoriteListModel
        .find(query)
        .select(selectFields)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.favoriteListModel.countDocuments(query).exec(),
    ]);

    return this.mapToResponse(data, total, page, resource_id);
  }

  async search(
    searchFavoriteListDto: SearchFavoriteListDto,
    pagination: PaginationDto,
    options: { user: User },
  ): Promise<FavoriteListResponseDto> {
    const { page, limit, resource_id } = pagination;
    const skip = (page - 1) * limit;

    const mongoQuery: FilterQuery<FavoriteList> = {
      ownerId: options.user.id,
    };

    if (searchFavoriteListDto.exclude) {
      mongoQuery.favorites = { $nin: [searchFavoriteListDto.exclude] };
    }

    if (searchFavoriteListDto.name) {
      const escapedName = this.escapeRegex(searchFavoriteListDto.name);
      mongoQuery.name = { $regex: escapedName, $options: 'i' };
    }

    const selectFields = `name description privacy ownerId ${resource_id ? 'favorites' : ''}`;

    const [data, total] = await Promise.all([
      this.favoriteListModel
        .find(mongoQuery)
        .select(selectFields)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.favoriteListModel.countDocuments(mongoQuery).exec(),
    ]);

    return this.mapToResponse(data, total, page, resource_id);
  }

  private mapToResponse(
    data: FavoriteListDocument[],
    total: number,
    page: number,
    resourceId?: string,
  ): FavoriteListResponseDto {
    return {
      total,
      page,
      items: data.map((item): FavoriteListItemDto => {
        const listItem: FavoriteListItemDto = {
          id: item._id.toString(),
          name: item.name,
          description: item.description,
          privacy: item.privacy,
          ownerId: item.ownerId,
        };

        if (resourceId !== undefined) {
          listItem.containsResource = item.favorites
            ? item.favorites.includes(resourceId)
            : false;
        }

        return listItem;
      }),
    };
  }

  async findOne(
    id: string,
    locale: string,
  ): Promise<FavoriteListDetailResponseDto> {
    const favoriteList = await this.favoriteListModel.findById(id).populate({
      path: 'favorites',
      model: 'Resource',
      select: '-serviceArea',
      transform: (doc: ResourceDocument | null) => {
        if (!doc) return null;

        const translation = doc.translations.find((el) => el.locale === locale);

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

    return {
      id: favoriteList._id.toString(),
      name: favoriteList.name,
      description: favoriteList.description,
      privacy: favoriteList.privacy,
      ownerId: favoriteList.ownerId,
      favorites: favoriteList.favorites,
    };
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

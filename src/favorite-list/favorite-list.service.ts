import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { InjectModel } from '@nestjs/mongoose';
import {
  FavoriteList,
  FavoriteListDocument,
} from 'src/common/schemas/favorite-list.schema';
import { Model, FilterQuery } from 'mongoose';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { PaginationDto } from './dto/pagination.dto';
import {
  FavoriteListResponseDto,
  FavoriteListDetailResponseDto,
  FavoriteListItemDto,
  FavoriteListSyncResponseDto,
} from './dto/favorite-list.response.dto';
import { SyncFavoriteListDto } from './dto/sync-favorite-list.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { ResourceService } from 'src/resource/resource.service';
import { TransformedResource } from 'src/resource/types/resource-response.types';

interface User {
  id: string;
}

interface FavoriteListOptions {
  user: User;
  tenantId?: string;
}

interface SyncFavoriteListResult {
  created: boolean;
  favoriteList?: FavoriteListSyncResponseDto;
}

interface FavoriteListSyncCandidate {
  _id: string;
  name: string;
  description: string;
  privacy: 'PUBLIC' | 'PRIVATE';
  ownerId: string;
  favorites: string[];
}

@Injectable()
export class FavoriteListService {
  private readonly logger = new Logger(FavoriteListService.name);

  constructor(
    @InjectModel(FavoriteList.name)
    private favoriteListModel: Model<FavoriteListDocument>,
    private readonly resourceService: ResourceService,
  ) {}

  private buildOwnershipFilter(options: FavoriteListOptions) {
    return {
      ownerId: options.user.id,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    };
  }

  private normalizeResourceIds(resourceIds: string[]): string[] {
    return [
      ...new Set(resourceIds.map((id) => id.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
  }

  private buildFavoriteListPayload({
    name,
    description,
    privacy,
    ownerId,
    tenantId,
    favorites = [],
  }: {
    name: string;
    description?: string;
    privacy?: 'PUBLIC' | 'PRIVATE';
    ownerId: string;
    tenantId?: string;
    favorites?: string[];
  }) {
    const normalizedFavorites = this.normalizeResourceIds(favorites);

    return {
      name,
      description: description ?? '',
      privacy: privacy ?? 'PRIVATE',
      ownerId,
      ...(tenantId ? { tenantId } : {}),
      favorites: normalizedFavorites,
    };
  }

  private mapToSyncResponse(
    favoriteList: FavoriteListDocument,
  ): FavoriteListSyncResponseDto {
    return {
      id: favoriteList._id.toString(),
      name: favoriteList.name,
      description: favoriteList.description,
      privacy: favoriteList.privacy,
      ownerId: favoriteList.ownerId,
      favorites: favoriteList.favorites.map((favorite) => favorite.toString()),
    };
  }

  private hasSameFavorites(
    favorites: string[] | undefined,
    normalizedResourceIds: string[],
  ): boolean {
    if (!favorites) {
      return normalizedResourceIds.length === 0;
    }

    const normalizedFavorites = this.normalizeResourceIds(
      favorites.map((favorite) => favorite.toString()),
    );

    return normalizedFavorites.every(
      (favoriteId, index) => favoriteId === normalizedResourceIds[index],
    );
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async findSummariesByIds(
    ids: string[],
    options?: { tenantId?: string },
  ): Promise<{ id: string; name: string; count: number }[]> {
    if (ids.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(ids)];

    const lists = await this.favoriteListModel
      .find(
        {
          _id: { $in: uniqueIds },
          ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
        },
        { _id: 1, name: 1, favorites: 1 },
      )
      .lean()
      .exec();

    return lists.map((list) => ({
      id: list._id.toString(),
      name: list.name,
      count: list.favorites?.length ?? 0,
    }));
  }

  async create(
    createFavoriteListDto: CreateFavoriteListDto,
    options: FavoriteListOptions,
  ) {
    this.logger.log(
      `Attempting to create favorite list for user: ${options.user.id}`,
    );

    const favoriteListData = this.buildFavoriteListPayload({
      name: createFavoriteListDto.name,
      description: createFavoriteListDto.description,
      privacy: createFavoriteListDto.public ? 'PUBLIC' : 'PRIVATE',
      ownerId: options.user.id,
      tenantId: options.tenantId,
      favorites: [],
    });

    try {
      const savedList = await this.favoriteListModel.create(favoriteListData);
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

  async syncLocalList(
    syncFavoriteListDto: SyncFavoriteListDto,
    options: FavoriteListOptions,
  ): Promise<SyncFavoriteListResult> {
    const normalizedResourceIds = this.normalizeResourceIds(
      syncFavoriteListDto.resourceIds,
    );

    if (normalizedResourceIds.length === 0) {
      throw new BadRequestException(
        'resourceIds must contain at least one resource ID.',
      );
    }

    const candidateLists = await this.favoriteListModel
      .aggregate<FavoriteListSyncCandidate>([
        { $match: this.buildOwnershipFilter(options) },
        {
          $project: {
            name: 1,
            description: 1,
            privacy: 1,
            ownerId: 1,
            favorites: { $ifNull: ['$favorites', []] },
          },
        },
        {
          $match: {
            $expr: {
              $eq: [{ $size: '$favorites' }, normalizedResourceIds.length],
            },
          },
        },
      ])
      .exec();

    const existingList = candidateLists.find((favoriteList) =>
      this.hasSameFavorites(favoriteList.favorites, normalizedResourceIds),
    );

    if (existingList) {
      return { created: false };
    }

    const createdList = await this.favoriteListModel.create(
      this.buildFavoriteListPayload({
        name: 'My New List',
        ownerId: options.user.id,
        tenantId: options.tenantId,
        favorites: normalizedResourceIds,
      }),
    );

    return {
      created: true,
      favoriteList: this.mapToSyncResponse(createdList),
    };
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
    headers: HeadersDto,
  ): Promise<FavoriteListDetailResponseDto> {
    const tenantId = headers['x-tenant-id'];

    const favoriteList = await this.favoriteListModel
      .findOne({ _id: id, tenantId })
      .exec();

    if (!favoriteList) {
      this.logger.warn(
        `Favorite list with ID: ${id} not found for tenant: ${tenantId}.`,
      );
      throw new NotFoundException();
    }

    const resourceIds = favoriteList.favorites.map((favorite) =>
      favorite.toString(),
    );

    const favorites = await this.resolveFavoriteResources(
      resourceIds,
      headers,
      id,
    );

    return {
      id: favoriteList._id.toString(),
      name: favoriteList.name,
      description: favoriteList.description,
      privacy: favoriteList.privacy,
      ownerId: favoriteList.ownerId,
      favorites,
    };
  }

  /**
   * Resolves the resources referenced by a favorites list, using
   * ResourceService's tenant-scoped, ID-fallback-aware batch lookup (the
   * same one printable-directory.service.ts uses for `favorites_list`
   * sources). Favorites that can't be resolved (deleted/redirected/not
   * found) are dropped rather than surfaced to the client, matching prior
   * behavior, but are logged for observability.
   */
  private async resolveFavoriteResources(
    resourceIds: string[],
    headers: HeadersDto,
    favoriteListId: string,
  ): Promise<TransformedResource[]> {
    if (resourceIds.length === 0) {
      return [];
    }

    const { data, errors } = await this.resourceService.findManyByIds(
      resourceIds,
      { headers },
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Failed to resolve ${errors.length} favorite(s) for list ${favoriteListId}: ${JSON.stringify(
          errors,
        )}`,
      );
    }

    return resourceIds
      .map((resourceId) => data[resourceId])
      .filter((resource): resource is TransformedResource => Boolean(resource));
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

  async purge(id: string, options: { user: User }) {
    this.logger.log(
      `Purging favorites from list with ID: ${id} for user: ${options.user.id}`,
    );
    try {
      const result = await this.favoriteListModel.updateOne(
        { _id: id, ownerId: options.user.id },
        { $set: { favorites: [] } },
      );

      if (result.matchedCount === 0) {
        this.logger.warn(
          `Favorite list with ID ${id} not found for user ${options.user.id} during purge.`,
        );
        throw new NotFoundException(
          `Favorite list with ID ${id} not found or user not authorized.`,
        );
      }

      this.logger.log(`Favorites purged from list ${id} successfully.`);

      return result;
    } catch (error) {
      this.logger.error(
        `Error purging favorites from list ${id} for user ${options.user.id}: ${error.message}`,
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  PRINTABLE_DIRECTORY_ACCESS_POLICIES,
  PrintableDirectory,
  PrintableDirectoryAccessPolicy,
  PrintableDirectoryDefaultQueryConfig,
  PrintableDirectoryDocument,
  PrintableDirectorySection,
  PrintableDirectorySectionSource,
} from 'src/common/schemas/printable-directory.schema';
import {
  CreatePrintableDirectoryDto,
  CreatePrintableDirectorySectionDto,
  CreatePrintableDirectorySourceDto,
  PrintableDirectoriesListQueryDto,
  ReorderPrintableDirectorySectionsDto,
  ReorderPrintableDirectorySourcesDto,
  UpdatePrintableDirectoryDto,
  UpdatePrintableDirectorySectionDto,
  UpdatePrintableDirectorySourceDto,
} from './dto';
import {
  PrintableDirectoryListResponseDto,
  PrintableDirectoryPreviewResponseDto,
  PrintableDirectoryPreviewSectionDto,
  PrintableDirectoryPreviewSectionResourceDto,
  PrintableDirectoryResponseDto,
} from './dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchResourcesBodyDto } from 'src/search/dto/search-body.dto';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import { SearchService } from 'src/search/search.service';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { ResourceService } from 'src/resource/resource.service';
import { FavoriteListService } from 'src/favorite-list/favorite-list.service';

interface RequestScope {
  tenantId: string;
  userId: string;
}

@Injectable()
export class PrintableDirectoryService {
  constructor(
    @InjectModel(PrintableDirectory.name)
    private readonly printableDirectoryModel: Model<PrintableDirectoryDocument>,
    @InjectModel(FavoriteList.name)
    private readonly favoriteListModel: Model<FavoriteList>,
    private readonly searchService: SearchService,
    private readonly resourceService: ResourceService,
    private readonly favoriteListService: FavoriteListService,
  ) {}

  async list(
    query: PrintableDirectoriesListQueryDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryListResponseDto> {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const mongoQuery: Record<string, unknown> = {
      tenantId: scope.tenantId,
      $or: [
        { ownerUserId: scope.userId },
        { accessPolicy: { $in: ['shared-read', 'shared-edit'] } },
      ],
    };

    if (search) {
      mongoQuery.name = { $regex: this.escapeRegex(search), $options: 'i' };
    }

    const [docs, total] = await Promise.all([
      this.printableDirectoryModel
        .find(mongoQuery)
        .sort({ updatedAt: -1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.printableDirectoryModel.countDocuments(mongoQuery).exec(),
    ]);

    return {
      total,
      page,
      items: await Promise.all(docs.map((doc) => this.toResponseDto(doc))),
    };
  }

  async create(
    payload: CreatePrintableDirectoryDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const created = await this.printableDirectoryModel.create({
      tenantId: scope.tenantId,
      ownerUserId: scope.userId,
      name: payload.name,
      updatedBy: scope.userId,
      accessPolicy: payload.accessPolicy ?? 'private',
      cover: {
        titleLocalized: { values: {} },
        descriptionLocalized: { values: {} },
        primaryColor: null,
        layoutType: 'default',
        coverImageUrl: null,
      },
      header: {
        layout: [],
        textLocalized: { values: {} },
        logoUrl: null,
      },
      footer: {
        layout: [],
        textLocalized: { values: {} },
        logoUrl: null,
      },
      resourceLayout: payload.resourceLayout ?? 'line',
      isBookletLayout: payload.isBookletLayout ?? false,
      defaultQueryConfig: this.normalizeDefaultQueryConfig(
        payload.defaultQueryConfig,
      ),
    });

    return this.toResponseDto(created);
  }

  async getById(
    id: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getReadableDirectoryOrThrow(id, scope);
    return this.toResponseDto(directory);
  }

  async update(
    id: string,
    payload: UpdatePrintableDirectoryDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(id, scope);

    if (payload.name !== undefined) {
      directory.name = payload.name;
    }

    if (payload.cover !== undefined) {
      directory.cover = {
        ...directory.cover,
        ...payload.cover,
        titleLocalized:
          payload.cover.titleLocalized !== undefined
            ? { values: payload.cover.titleLocalized.values ?? {} }
            : directory.cover.titleLocalized,
        descriptionLocalized:
          payload.cover.descriptionLocalized !== undefined
            ? { values: payload.cover.descriptionLocalized.values ?? {} }
            : directory.cover.descriptionLocalized,
      };
    }

    if (payload.header !== undefined) {
      directory.header = {
        ...directory.header,
        ...payload.header,
        textLocalized:
          payload.header.textLocalized !== undefined
            ? { values: payload.header.textLocalized.values ?? {} }
            : directory.header.textLocalized,
      };
    }

    if (payload.footer !== undefined) {
      directory.footer = {
        ...directory.footer,
        ...payload.footer,
        textLocalized:
          payload.footer.textLocalized !== undefined
            ? { values: payload.footer.textLocalized.values ?? {} }
            : directory.footer.textLocalized,
      };
    }

    if (payload.resourceLayout !== undefined) {
      directory.resourceLayout = payload.resourceLayout;
    }

    if (payload.isBookletLayout !== undefined) {
      directory.isBookletLayout = payload.isBookletLayout;
    }

    if (payload.accessPolicy !== undefined) {
      directory.accessPolicy = payload.accessPolicy;
    }

    if (payload.defaultQueryConfig !== undefined) {
      directory.defaultQueryConfig = this.normalizeDefaultQueryConfig(
        payload.defaultQueryConfig,
      );
    }

    directory.updatedBy = scope.userId;

    await directory.save();
    return this.toResponseDto(directory);
  }

  async remove(id: string, scope: RequestScope): Promise<void> {
    const directory = await this.getOwnedDirectoryOrThrow(id, scope);
    await this.printableDirectoryModel.deleteOne({ _id: directory._id }).exec();
  }

  async createSection(
    directoryId: string,
    payload: CreatePrintableDirectorySectionDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const sectionOrder = directory.sections.length;

    const sources: PrintableDirectorySectionSource[] = (
      payload.sources ?? []
    ).map((source, index) => this.toSourceEntity(source, index));

    directory.sections.push({
      id: randomUUID(),
      order: sectionOrder,
      headingLocalized: payload.headingLocalized,
      descriptionLocalized: payload.descriptionLocalized ?? { values: {} },
      maxResources: payload.maxResources ?? 100,
      sources,
    } as PrintableDirectorySection);

    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async updateSection(
    directoryId: string,
    sectionId: string,
    payload: UpdatePrintableDirectorySectionDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const section = this.getSectionOrThrow(directory, sectionId);

    if (payload.headingLocalized !== undefined) {
      section.headingLocalized = {
        values: payload.headingLocalized.values ?? {},
      };
    }

    if (payload.descriptionLocalized !== undefined) {
      section.descriptionLocalized = {
        values: payload.descriptionLocalized.values ?? {},
      };
    }

    if (payload.maxResources !== undefined) {
      section.maxResources = payload.maxResources;
    }

    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async removeSection(
    directoryId: string,
    sectionId: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const before = directory.sections.length;
    directory.sections = directory.sections.filter(
      (section) => section.id !== sectionId,
    );

    if (before === directory.sections.length) {
      throw new NotFoundException('Section not found');
    }

    this.reindexSections(directory);
    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async reorderSections(
    directoryId: string,
    payload: ReorderPrintableDirectorySectionsDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const existingIds = directory.sections.map((section) => section.id);

    this.validateExactIdSet(existingIds, payload.sectionIds, 'sectionIds');

    const sectionMap = new Map(
      directory.sections.map((section) => [section.id, section] as const),
    );

    directory.sections = payload.sectionIds.map(
      (sectionId, order) =>
        ({
          ...sectionMap.get(sectionId),
          order,
        }) as PrintableDirectorySection,
    );

    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async createSource(
    directoryId: string,
    sectionId: string,
    payload: CreatePrintableDirectorySourceDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const section = this.getSectionOrThrow(directory, sectionId);

    section.sources.push(this.toSourceEntity(payload, section.sources.length));

    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async updateSource(
    directoryId: string,
    sectionId: string,
    sourceId: string,
    payload: UpdatePrintableDirectorySourceDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const section = this.getSectionOrThrow(directory, sectionId);
    const source = this.getSourceOrThrow(section, sourceId);

    if (payload.type !== undefined) {
      source.type = payload.type;
    }
    if (payload.query !== undefined) {
      source.query = this.toStoredQueryPayload(payload.query);
    }
    if (payload.favoritesListId !== undefined) {
      source.favoritesListId = payload.favoritesListId;
    }
    if (payload.resourceIds !== undefined) {
      source.resourceIds = payload.resourceIds;
    }

    this.ensureSourceShape(source);
    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async removeSource(
    directoryId: string,
    sectionId: string,
    sourceId: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const section = this.getSectionOrThrow(directory, sectionId);

    const before = section.sources.length;
    section.sources = section.sources.filter(
      (source) => source.id !== sourceId,
    );

    if (before === section.sources.length) {
      throw new NotFoundException('Source not found');
    }

    this.reindexSources(section);
    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async reorderSources(
    directoryId: string,
    sectionId: string,
    payload: ReorderPrintableDirectorySourcesDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryResponseDto> {
    const directory = await this.getUpdatableDirectoryOrThrow(
      directoryId,
      scope,
    );
    const section = this.getSectionOrThrow(directory, sectionId);
    const existingIds = section.sources.map((source) => source.id);

    this.validateExactIdSet(existingIds, payload.sourceIds, 'sourceIds');

    const sourceMap = new Map(
      section.sources.map((source) => [source.id, source] as const),
    );

    section.sources = payload.sourceIds.map(
      (sourceId, order) =>
        ({
          ...sourceMap.get(sourceId),
          order,
        }) as PrintableDirectorySectionSource,
    );

    directory.updatedBy = scope.userId;
    await directory.save();
    return this.toResponseDto(directory);
  }

  async preview(
    directoryId: string,
    locale: string,
    headers: HeadersDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryPreviewResponseDto> {
    const directory = await this.getReadableDirectoryOrThrow(
      directoryId,
      scope,
    );

    const previewLocale = locale || headers['accept-language'] || 'en';
    const previewHeaders: HeadersDto = {
      ...headers,
      'x-tenant-id': scope.tenantId,
      'accept-language': previewLocale,
    };

    const resolvedBaseDirectoryDto = await this.toResponseDto(directory);

    const sections = [...directory.sections]
      .sort((left, right) => left.order - right.order)
      .map((section, index) =>
        this.resolveSectionForPreview(
          directory,
          section,
          resolvedBaseDirectoryDto.sections[index],
          previewLocale,
          previewHeaders,
          scope,
        ),
      );

    const resolvedSections = await Promise.all(sections);

    return plainToInstance(PrintableDirectoryPreviewResponseDto, {
      ...resolvedBaseDirectoryDto,
      directoryId: resolvedBaseDirectoryDto.id,
      locale: previewLocale,
      sections: resolvedSections,
      generatedAt: new Date().toISOString(),
    });
  }

  private async resolveSectionForPreview(
    directory: PrintableDirectoryDocument,
    section: PrintableDirectorySection,
    sectionDto: PrintableDirectoryResponseDto['sections'][number],
    locale: string,
    headers: HeadersDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryPreviewSectionDto> {
    const orderedSources = [...section.sources].sort(
      (left, right) => left.order - right.order,
    );

    const mergedResources: PrintableDirectoryPreviewSectionResourceDto[] = [];
    const seenIds = new Set<string>();

    for (const source of orderedSources) {
      const resources = await this.resolveSourceResources(
        directory,
        source,
        headers,
        scope,
      );
      for (const resource of resources) {
        if (!seenIds.has(resource.id)) {
          seenIds.add(resource.id);
          mergedResources.push(resource);
        }
      }
    }

    return {
      id: section.id,
      order: section.order,
      headingLocalized: sectionDto.headingLocalized,
      descriptionLocalized: sectionDto.descriptionLocalized,
      maxResources: section.maxResources,
      sources: sectionDto.sources,
      resolvedHeading: this.resolveLocalizedText(
        section.headingLocalized?.values ?? {},
        locale,
      ),
      resolvedDescription: this.resolveLocalizedText(
        section.descriptionLocalized?.values ?? {},
        locale,
      ),
      resources: mergedResources.slice(0, section.maxResources),
    };
  }

  private async resolveSourceResources(
    directory: PrintableDirectoryDocument,
    source: PrintableDirectorySectionSource,
    headers: HeadersDto,
    scope: RequestScope,
  ): Promise<PrintableDirectoryPreviewSectionResourceDto[]> {
    if (source.type === 'resource_ids') {
      return this.resolveResourcesByIds(source.resourceIds ?? [], headers);
    }

    if (source.type === 'favorites_list') {
      if (!source.favoritesListId) {
        throw new BadRequestException(
          'favoritesListId is required for favorites_list source',
        );
      }

      const favoriteList = await this.favoriteListModel
        .findOne({
          _id: source.favoritesListId,
          ownerId: scope.userId,
          tenantId: scope.tenantId,
        })
        .lean()
        .exec();

      if (!favoriteList) {
        throw new NotFoundException(
          `Favorites list not found: ${source.favoritesListId}`,
        );
      }

      return this.resolveResourcesByIds(favoriteList.favorites ?? [], headers);
    }

    if (!source.query) {
      throw new BadRequestException(
        'query payload is required for query source',
      );
    }

    const parsedQuery = this.parseSearchQueryOrThrow(
      this.withDefaultQueryParams(source.query.params, directory),
    );
    const parsedBody = source.query.body
      ? this.parseSearchBodyOrThrow(source.query.body)
      : undefined;

    const response = await this.searchService.searchResources({
      headers,
      query: parsedQuery,
      body: parsedBody,
    });

    const orderedIds = response.search.hits.hits
      .map((hit) => hit?._source?.id ?? hit?._id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    return this.resolveResourcesByIds(orderedIds, headers);
  }

  private async resolveResourcesByIds(
    ids: string[],
    headers: HeadersDto,
  ): Promise<PrintableDirectoryPreviewSectionResourceDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const batchResponse = await this.resourceService.findManyByIds(ids, {
      headers,
    });

    if (batchResponse.errors.length > 0) {
      throw new BadRequestException({
        message: 'Failed to resolve one or more resources for preview',
        errors: batchResponse.errors,
      });
    }

    return ids
      .map((id) => batchResponse.data[id])
      .filter(Boolean)
      .map((resource) => ({
        id: resource._id,
        resource,
      }));
  }

  private getSectionOrThrow(
    directory: PrintableDirectoryDocument,
    sectionId: string,
  ): PrintableDirectorySection {
    const section = directory.sections.find(
      (candidate) => candidate.id === sectionId,
    );
    if (!section) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }

  private getSourceOrThrow(
    section: PrintableDirectorySection,
    sourceId: string,
  ): PrintableDirectorySectionSource {
    const source = section.sources.find(
      (candidate) => candidate.id === sourceId,
    );
    if (!source) {
      throw new NotFoundException('Source not found');
    }
    return source;
  }

  private validateExactIdSet(
    expectedIds: string[],
    providedIds: string[],
    fieldName: string,
  ): void {
    if (expectedIds.length !== providedIds.length) {
      throw new BadRequestException(
        `${fieldName} must contain exactly ${expectedIds.length} ids`,
      );
    }

    const expected = new Set(expectedIds);
    const provided = new Set(providedIds);

    if (
      expected.size !== provided.size ||
      expected.size !== expectedIds.length
    ) {
      throw new BadRequestException(`${fieldName} must not contain duplicates`);
    }

    for (const id of provided) {
      if (!expected.has(id)) {
        throw new BadRequestException(
          `${fieldName} contains unknown id: ${id}`,
        );
      }
    }
  }

  private reindexSections(directory: PrintableDirectoryDocument): void {
    directory.sections = [...directory.sections]
      .sort((left, right) => left.order - right.order)
      .map((section, index) => ({
        ...section,
        order: index,
      })) as PrintableDirectorySection[];
  }

  private reindexSources(section: PrintableDirectorySection): void {
    section.sources = [...section.sources]
      .sort((left, right) => left.order - right.order)
      .map((source, index) => ({
        ...source,
        order: index,
      })) as PrintableDirectorySectionSource[];
  }

  private ensureSourceShape(source: PrintableDirectorySectionSource): void {
    if (source.type === 'query' && !source.query) {
      throw new BadRequestException(
        'query payload is required when source type is query',
      );
    }
    if (source.type === 'favorites_list' && !source.favoritesListId) {
      throw new BadRequestException(
        'favoritesListId is required when source type is favorites_list',
      );
    }
    if (
      source.type === 'resource_ids' &&
      (!source.resourceIds || source.resourceIds.length === 0)
    ) {
      throw new BadRequestException(
        'resourceIds is required when source type is resource_ids',
      );
    }
  }

  private toSourceEntity(
    payload: CreatePrintableDirectorySourceDto,
    order: number,
  ): PrintableDirectorySectionSource {
    const source: PrintableDirectorySectionSource = {
      id: randomUUID(),
      order,
      type: payload.type,
      query: this.toStoredQueryPayload(payload.query),
      favoritesListId: payload.favoritesListId ?? null,
      resourceIds: payload.resourceIds,
    };

    this.ensureSourceShape(source);
    return source;
  }

  private toStoredQueryPayload(
    query:
      | CreatePrintableDirectorySourceDto['query']
      | UpdatePrintableDirectorySourceDto['query'],
  ): PrintableDirectorySectionSource['query'] {
    if (!query) {
      return null;
    }

    return {
      title: query.title ?? null,
      params: { ...(query.params as Record<string, unknown>) },
      body: query.body ? { ...(query.body as Record<string, unknown>) } : null,
    };
  }

  private parseSearchQueryOrThrow(raw: unknown): SearchResourcesQueryDto {
    const parsed = plainToInstance(SearchResourcesQueryDto, raw);
    const errors = validateSync(parsed, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      throw new BadRequestException('Invalid serialized search query params');
    }

    return parsed;
  }

  private parseSearchBodyOrThrow(raw: unknown): SearchResourcesBodyDto {
    const parsed = plainToInstance(SearchResourcesBodyDto, raw);
    const errors = validateSync(parsed, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      throw new BadRequestException('Invalid serialized search body payload');
    }

    return parsed;
  }

  private normalizeDefaultQueryConfig(
    raw: UpdatePrintableDirectoryDto['defaultQueryConfig'],
  ): PrintableDirectoryDefaultQueryConfig | null {
    if (raw === null) {
      return null;
    }

    if (raw === undefined) {
      return null;
    }

    return {
      locationName: raw.locationName ?? null,
      coords: raw.coords ?? null,
      radius: raw.radius ?? null,
    };
  }

  private withDefaultQueryParams(
    params: Record<string, unknown>,
    directory: PrintableDirectoryDocument,
  ): Record<string, unknown> {
    const mergedParams = { ...params };
    const defaults = directory.defaultQueryConfig;

    if (!defaults) {
      return mergedParams;
    }

    if (
      (mergedParams.coords === undefined || mergedParams.coords === null) &&
      defaults.coords
    ) {
      mergedParams.coords = defaults.coords;
    }

    if (
      (mergedParams.distance === undefined || mergedParams.distance === null) &&
      defaults.radius !== undefined &&
      defaults.radius !== null
    ) {
      mergedParams.distance = defaults.radius;
    }

    return mergedParams;
  }

  private resolveLocalizedText(
    values: Record<string, string>,
    locale: string,
  ): string {
    return values[locale] ?? values.en ?? '';
  }

  private async getOwnedDirectoryOrThrow(
    id: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryDocument> {
    const directory = await this.printableDirectoryModel
      .findOne({
        _id: id,
        tenantId: scope.tenantId,
        ownerUserId: scope.userId,
      })
      .exec();

    if (!directory) {
      throw new NotFoundException('Printable directory not found');
    }

    return directory;
  }

  private async getReadableDirectoryOrThrow(
    id: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryDocument> {
    const directory = await this.printableDirectoryModel
      .findOne({
        _id: id,
        tenantId: scope.tenantId,
        $or: [
          { ownerUserId: scope.userId },
          { accessPolicy: { $in: ['shared-read', 'shared-edit'] } },
        ],
      })
      .exec();

    if (!directory) {
      throw new NotFoundException('Printable directory not found');
    }

    return directory;
  }

  private async getUpdatableDirectoryOrThrow(
    id: string,
    scope: RequestScope,
  ): Promise<PrintableDirectoryDocument> {
    const directory = await this.printableDirectoryModel
      .findOne({
        _id: id,
        tenantId: scope.tenantId,
        $or: [{ ownerUserId: scope.userId }, { accessPolicy: 'shared-edit' }],
      })
      .exec();

    if (!directory) {
      throw new NotFoundException('Printable directory not found');
    }

    return directory;
  }

  private async toResponseDto(
    directory: PrintableDirectoryDocument,
  ): Promise<PrintableDirectoryResponseDto> {
    const timestamps = directory as PrintableDirectoryDocument & {
      createdAt?: Date;
      updatedAt?: Date;
    };

    const allSources = (directory.sections ?? []).flatMap(
      (section) => section.sources ?? [],
    );

    const favoriteListIds = Array.from(
      new Set(
        allSources
          .map((source) => source.favoritesListId)
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    );

    const resourceIds = Array.from(
      new Set(
        allSources
          .flatMap((source) => source.resourceIds ?? [])
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    );

    const [favoriteListSummaries, resources] = await Promise.all([
      this.favoriteListService.findSummariesByIds(favoriteListIds, {
        tenantId: directory.tenantId,
      }),
      this.resourceService.findTitlesByIds(resourceIds),
    ]);

    const favoriteListById = new Map(
      favoriteListSummaries.map((favoriteList) => [
        favoriteList.id,
        favoriteList,
      ]),
    );
    const resourceNameById = new Map(
      resources.map((resource) => [resource.id, resource.displayName]),
    );

    return {
      id: directory._id.toString(),
      tenantId: directory.tenantId,
      ownerUserId: directory.ownerUserId,
      name: directory.name,
      updatedBy: directory.updatedBy ?? null,
      accessPolicy:
        (directory.accessPolicy as PrintableDirectoryAccessPolicy) ??
        PRINTABLE_DIRECTORY_ACCESS_POLICIES[0],
      cover: {
        titleLocalized: directory.cover?.titleLocalized ?? {
          values: {},
        },
        descriptionLocalized: directory.cover?.descriptionLocalized ?? {
          values: {},
        },
        primaryColor: directory.cover?.primaryColor ?? null,
        layoutType: directory.cover?.layoutType ?? 'default',
        coverImageUrl: directory.cover?.coverImageUrl ?? null,
      },
      header: {
        layout: directory.header?.layout ?? [],
        textLocalized: directory.header?.textLocalized ?? { values: {} },
        logoUrl: directory.header?.logoUrl ?? null,
      },
      footer: {
        layout: directory.footer?.layout ?? [],
        textLocalized: directory.footer?.textLocalized ?? { values: {} },
        logoUrl: directory.footer?.logoUrl ?? null,
      },
      resourceLayout: directory.resourceLayout ?? 'line',
      isBookletLayout: directory.isBookletLayout ?? false,
      defaultQueryConfig: directory.defaultQueryConfig
        ? {
            locationName: directory.defaultQueryConfig.locationName ?? null,
            coords: directory.defaultQueryConfig.coords ?? null,
            radius: directory.defaultQueryConfig.radius ?? null,
          }
        : null,
      sections: [...(directory.sections ?? [])]
        .sort((left, right) => left.order - right.order)
        .map((section) => ({
          id: section.id,
          order: section.order,
          headingLocalized: section.headingLocalized ?? { values: {} },
          descriptionLocalized: section.descriptionLocalized ?? { values: {} },
          maxResources: section.maxResources,
          sources: [...(section.sources ?? [])]
            .sort((left, right) => left.order - right.order)
            .map((source) => {
              const resourceCounts = new Map<string, number>();
              for (const resourceId of source.resourceIds ?? []) {
                resourceCounts.set(
                  resourceId,
                  (resourceCounts.get(resourceId) ?? 0) + 1,
                );
              }

              const favoriteList = source.favoritesListId
                ? favoriteListById.get(source.favoritesListId)
                : null;

              return {
                id: source.id,
                order: source.order,
                type: source.type,
                query: source.query ?? null,
                favoriteList: source.favoritesListId
                  ? {
                      id: source.favoritesListId,
                      name: favoriteList?.name ?? '',
                      count: favoriteList?.count ?? 0,
                    }
                  : null,
                resources: Array.from(resourceCounts.entries()).map(
                  ([resourceId, count]) => ({
                    id: resourceId,
                    name: resourceNameById.get(resourceId) ?? '',
                    count,
                  }),
                ),
              };
            }),
        })),
      createdAt: timestamps.createdAt?.toISOString(),
      updatedAt: timestamps.updatedAt?.toISOString(),
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

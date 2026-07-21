import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Put,
  Res,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import {
  ApiTags,
  ApiResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import { User } from 'src/common/decorators/User';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ApiTenantIdQuery, ApiLocaleQuery } from 'src/common/decorators';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { PaginationDto, paginationSchema } from './dto/pagination.dto';
import {
  FavoriteListResponseDto,
  FavoriteListDetailResponseDto,
  FavoriteListSyncResponseDto,
} from './dto/favorite-list.response.dto';
import { KeycloakAuthService } from 'src/auth/services/keycloak-auth.service';
import { SyncFavoriteListDto } from './dto/sync-favorite-list.dto';
import { Request, Response } from 'express';

@ApiTags('Favorite List')
@Controller({
  path: 'favorite-list',
  version: '1',
})
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class FavoriteListController {
  constructor(
    private readonly favoriteListService: FavoriteListService,
    private readonly keycloakAuthService: KeycloakAuthService,
  ) {}

  @Post()
  @UseGuards(KeycloakGuard)
  create(
    @Body() createFavoriteListDto: CreateFavoriteListDto,
    @User() user: User,
    @Req() request: Request,
  ) {
    return this.favoriteListService.create(createFavoriteListDto, {
      user,
      tenantId: request.tenantId,
    });
  }

  @Post('sync')
  @UseGuards(KeycloakGuard)
  @ApiBody({ type: SyncFavoriteListDto })
  @ApiCreatedResponse({ type: FavoriteListSyncResponseDto })
  @ApiNoContentResponse({
    description: 'An identical favorite list already exists.',
  })
  async syncLocalList(
    @Body() syncFavoriteListDto: SyncFavoriteListDto,
    @User() user: User,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FavoriteListSyncResponseDto | void> {
    const result = await this.favoriteListService.syncLocalList(
      syncFavoriteListDto,
      {
        user,
        tenantId: request.tenantId,
      },
    );

    response.status(
      result.created ? HttpStatus.CREATED : HttpStatus.NO_CONTENT,
    );

    return result.favoriteList;
  }

  @Get()
  @UseGuards(KeycloakGuard)
  @ApiResponse({ type: FavoriteListResponseDto })
  findAll(
    @Query(new ZodValidationPipe(paginationSchema)) pagination: PaginationDto,
    @User() user,
  ) {
    return this.favoriteListService.findAll(pagination, { user });
  }

  @Get('search')
  @UseGuards(KeycloakGuard)
  @ApiResponse({ type: FavoriteListResponseDto })
  search(
    @Query() query: SearchFavoriteListDto,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: PaginationDto,
    @User() user,
  ): Promise<FavoriteListResponseDto> {
    return this.favoriteListService.search(query, pagination, { user });
  }

  @Get(':id')
  @ApiResponse({ type: FavoriteListDetailResponseDto })
  async findOne(
    @Param('id') id: string,
    @Req() request,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<FavoriteListDetailResponseDto> {
    const locale = headers['accept-language'];
    const favoriteList = await this.favoriteListService.findOne(id, locale);

    if (favoriteList.privacy === 'PRIVATE') {
      const authResult = await this.keycloakAuthService.verifyToken(request);

      if (!(
        authResult.isAuthenticated && authResult.userId === favoriteList.ownerId
      )) {
        throw new UnauthorizedException();
      }
    }

    return favoriteList;
  }

  @Put(':id')
  @UseGuards(KeycloakGuard)
  update(
    @Param('id') id: string,
    @Body() updateFavoriteListDto: UpdateFavoriteListDto,
    @User() user,
  ) {
    return this.favoriteListService.update(id, updateFavoriteListDto, { user });
  }

  @Delete(':id/favorites')
  @UseGuards(KeycloakGuard)
  purge(@Param('id') id: string, @User() user: User) {
    return this.favoriteListService.purge(id, { user });
  }

  @Delete(':id')
  @UseGuards(KeycloakGuard)
  remove(@Param('id') id: string, @User() user: User) {
    return this.favoriteListService.remove(id, { user });
  }
}

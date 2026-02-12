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
} from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { ApiTags, ApiResponse } from '@nestjs/swagger';
import { KeycloakGuard } from 'src/common/guards/keycloak.guard';
import { User } from 'src/common/decorators/User';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { PaginationDto, paginationSchema } from './dto/pagination.dto';
import {
  FavoriteListResponseDto,
  FavoriteListDetailResponseDto,
} from './dto/favorite-list.response.dto';

@ApiTags('Favorite List')
@Controller({
  path: 'favorite-list',
  version: '1',
})
export class FavoriteListController {
  constructor(private readonly favoriteListService: FavoriteListService) {}

  @Post()
  @UseGuards(KeycloakGuard)
  create(@Body() createFavoriteListDto: CreateFavoriteListDto, @User() user) {
    return this.favoriteListService.create(createFavoriteListDto, { user });
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
  @UseGuards(KeycloakGuard)
  @ApiResponse({ type: FavoriteListDetailResponseDto })
  findOne(
    @Param('id') id: string,
    @Req() request,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<FavoriteListDetailResponseDto> {
    return this.favoriteListService.findOne(id, {
      request,
      headers,
    });
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

  @Delete(':id')
  @UseGuards(KeycloakGuard)
  remove(@Param('id') id: string, @User() user: User) {
    return this.favoriteListService.remove(id, { user });
  }
}

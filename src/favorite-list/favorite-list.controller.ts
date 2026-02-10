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
  Version,
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
import { FavoriteListV2ResponseDto } from './dto/favorite-list-v2.response.dto';

@ApiTags('Favorite List')
@Controller('favorite-list')
export class FavoriteListController {
  constructor(private readonly favoriteListService: FavoriteListService) {}

  @Post()
  @Version('1')
  @UseGuards(KeycloakGuard)
  create(@Body() createFavoriteListDto: CreateFavoriteListDto, @User() user) {
    return this.favoriteListService.create(createFavoriteListDto, { user });
  }

  @Get()
  @Version('2')
  @UseGuards(KeycloakGuard)
  @ApiResponse({ type: FavoriteListV2ResponseDto })
  findAllV2(
    @Query(new ZodValidationPipe(paginationSchema)) pagination: PaginationDto,
    @User() user,
  ) {
    return this.favoriteListService.findAllV2(pagination, { user });
  }

  @Get()
  @Version('1')
  @UseGuards(KeycloakGuard)
  findAll(@User() user) {
    return this.favoriteListService.findAll({ user });
  }

  @Get('search')
  @Version('2')
  @UseGuards(KeycloakGuard)
  @ApiResponse({ type: FavoriteListV2ResponseDto })
  searchV2(
    @Query() query: SearchFavoriteListDto,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: PaginationDto,
    @User() user,
  ) {
    return this.favoriteListService.searchV2(query, pagination, { user });
  }

  @Get('search')
  @Version('1')
  @UseGuards(KeycloakGuard)
  search(@Query() query: SearchFavoriteListDto, @User() user) {
    return this.favoriteListService.search(query, { user });
  }

  @Get(':id')
  @Version('1')
  findOne(
    @Param('id') id: string,
    @Req() request,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.favoriteListService.findOne(id, {
      request,
      headers,
    });
  }

  @Put(':id')
  @Version('1')
  @UseGuards(KeycloakGuard)
  update(
    @Param('id') id: string,
    @Body() updateFavoriteListDto: UpdateFavoriteListDto,
    @User() user,
  ) {
    return this.favoriteListService.update(id, updateFavoriteListDto, { user });
  }

  @Delete(':id')
  @Version('1')
  @UseGuards(KeycloakGuard)
  remove(@Param('id') id: string, @User() user: User) {
    return this.favoriteListService.remove(id, { user });
  }
}

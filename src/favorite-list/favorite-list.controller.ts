import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { CreateFavoriteListDto } from './dto/create-favorite-list.dto';
import { UpdateFavoriteListDto } from './dto/update-favorite-list.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Favorite List')
@Controller('favorite-list')
export class FavoriteListController {
  constructor(private readonly favoriteListService: FavoriteListService) {}

  @Post()
  create(@Body() createFavoriteListDto: CreateFavoriteListDto) {
    return this.favoriteListService.create(createFavoriteListDto);
  }

  @Get()
  findAll() {
    return this.favoriteListService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.favoriteListService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateFavoriteListDto: UpdateFavoriteListDto,
  ) {
    return this.favoriteListService.update(+id, updateFavoriteListDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.favoriteListService.remove(+id);
  }
}

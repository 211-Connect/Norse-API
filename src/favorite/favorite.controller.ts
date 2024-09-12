import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { ApiTags } from '@nestjs/swagger';
import { KeycloakGuard } from 'src/common/guards/keycloak.guard';
import { User } from 'src/common/decorators/User';

@ApiTags('Favorite')
@Controller('favorite')
@UseGuards(KeycloakGuard)
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) {}

  @Post()
  create(@Body() createFavoriteDto: CreateFavoriteDto, @User() user: User) {
    return this.favoriteService.create(createFavoriteDto, { user });
  }

  @Delete(':favoriteId/:favoriteListId')
  remove(
    @Param('favoriteId') favoriteId: string,
    @Param('favoriteListId') favoriteListId: string,
    @User() user: User,
  ) {
    return this.favoriteService.remove({ favoriteId, favoriteListId, user });
  }
}

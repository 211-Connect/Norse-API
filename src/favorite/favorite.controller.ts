import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Version,
} from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { ApiTags } from '@nestjs/swagger';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import { User } from 'src/common/decorators/User';

@ApiTags('Favorite')
@Controller('favorite')
@UseGuards(KeycloakGuard)
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) {}

  @Post()
  @Version('1')
  create(@Body() createFavoriteDto: CreateFavoriteDto, @User() user: User) {
    return this.favoriteService.create(createFavoriteDto, { user });
  }

  @Delete(':favoriteId/:favoriteListId')
  @Version('1')
  remove(
    @Param('favoriteId') favoriteId: string,
    @Param('favoriteListId') favoriteListId: string,
    @User() user: User,
  ) {
    return this.favoriteService.remove({ favoriteId, favoriteListId, user });
  }
}

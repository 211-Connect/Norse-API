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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import { User } from 'src/common/decorators/User';
import { ApiTenantIdQuery } from 'src/common/decorators';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';

@ApiTags('Favorite')
@Controller('favorite')
@UseGuards(KeycloakGuard)
@ApiBearerAuth()
@ApiTenantIdQuery()
@ApiHeader({
  name: 'x-tenant-id',
  required: true,
  description: X_TENANT_ID_HEADER_DESCRIPTION,
})
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

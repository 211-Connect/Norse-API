import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { User } from 'src/common/decorators/User';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import { ApiTenantIdQuery } from 'src/common/decorators';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import {
  CreatePrintableDirectoryDeliveryDto,
  PrintableDirectoryDeliveryListResponseDto,
  PrintableDirectoryDeliveryResponseDto,
  UpdatePrintableDirectoryDeliveryDto,
} from './dto';
import { PrintableDirectoryDeliveryService } from './printable-directory-delivery.service';

@ApiTags('Printable Directory Deliveries')
@UseGuards(KeycloakGuard)
@ApiBearerAuth()
@Controller({
  path: 'printable-directories/:id/deliveries',
  version: '1',
})
@ApiTenantIdQuery()
@ApiHeader({
  name: 'x-tenant-id',
  required: true,
  description: X_TENANT_ID_HEADER_DESCRIPTION,
})
export class PrintableDirectoryDeliveryController {
  constructor(
    private readonly deliveryService: PrintableDirectoryDeliveryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: PrintableDirectoryDeliveryListResponseDto })
  @ApiOperation({
    summary: 'List scheduled PDF deliveries',
    description: 'Requires edit access to the directory.',
  })
  list(
    @Param('id') id: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryDeliveryListResponseDto> {
    return this.deliveryService.list(id, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Post()
  @ApiCreatedResponse({ type: PrintableDirectoryDeliveryResponseDto })
  @ApiConflictResponse({
    description: 'The directory already has the maximum number of deliveries.',
  })
  @ApiOperation({
    summary: 'Create a scheduled PDF delivery',
    description:
      "Requires edit access to the directory. The creator's email is taken from the token.",
  })
  create(
    @Param('id') id: string,
    @Body() payload: CreatePrintableDirectoryDeliveryDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    return this.deliveryService.create(id, payload, {
      tenantId: request.tenantId,
      userId: user.id,
      email: user.email,
    });
  }

  @Patch(':deliveryId')
  @ApiOkResponse({ type: PrintableDirectoryDeliveryResponseDto })
  @ApiOperation({ summary: 'Update a scheduled PDF delivery' })
  update(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Body() payload: UpdatePrintableDirectoryDeliveryDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    return this.deliveryService.update(id, deliveryId, payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Delete(':deliveryId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Delete a scheduled PDF delivery' })
  remove(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<void> {
    return this.deliveryService.remove(id, deliveryId, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }
}

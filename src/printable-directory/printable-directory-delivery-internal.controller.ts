import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { ApiTenantIdQuery } from 'src/common/decorators';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import {
  ClaimPrintableDirectoryDeliveryDto,
  ClaimPrintableDirectoryDeliveryResponseDto,
  DuePrintableDirectoryDeliveriesQueryDto,
  DuePrintableDirectoryDeliveryListResponseDto,
  PrintableDirectoryDeliveryResponseDto,
  PrintableDirectoryPreviewQueryDto,
  PrintableDirectoryPreviewResponseDto,
  ReportPrintableDirectoryDeliveryResultDto,
} from './dto';
import { PrintableDirectoryDeliveryService } from './printable-directory-delivery.service';

/**
 * Service-to-service endpoints for Norse's daily scheduled PDF delivery job.
 * Guarded by the internal API key; every call is still scoped to the tenant
 * in `x-tenant-id`.
 */
@ApiTags('Printable Directory Deliveries (Internal)')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
@Controller({
  path: 'internal/printable-directory-deliveries',
  version: '1',
})
@ApiTenantIdQuery()
@ApiHeader({
  name: 'x-tenant-id',
  required: true,
  description: X_TENANT_ID_HEADER_DESCRIPTION,
})
export class PrintableDirectoryDeliveryInternalController {
  constructor(
    private readonly deliveryService: PrintableDirectoryDeliveryService,
  ) {}

  @Get('due')
  @ApiOkResponse({ type: DuePrintableDirectoryDeliveryListResponseDto })
  @ApiOperation({
    summary: 'List deliveries due on a date',
    description:
      'Enabled deliveries of the tenant scheduled for the calendar date and not yet claimed for it.',
  })
  listDue(
    @Query() query: DuePrintableDirectoryDeliveriesQueryDto,
    @Req() request: Request,
  ): Promise<DuePrintableDirectoryDeliveryListResponseDto> {
    return this.deliveryService.listDue(request.tenantId, query.date);
  }

  @Post(':deliveryId/claim')
  @HttpCode(200)
  @ApiOkResponse({ type: ClaimPrintableDirectoryDeliveryResponseDto })
  @ApiOperation({
    summary: 'Claim a delivery for a date',
    description:
      'Atomic: only the first claim for a date returns claimed=true, so a delivery is sent at most once per day.',
  })
  claim(
    @Param('deliveryId') deliveryId: string,
    @Body() payload: ClaimPrintableDirectoryDeliveryDto,
    @Req() request: Request,
  ): Promise<ClaimPrintableDirectoryDeliveryResponseDto> {
    return this.deliveryService.claim(
      request.tenantId,
      deliveryId,
      payload.date,
    );
  }

  @Post(':deliveryId/result')
  @HttpCode(200)
  @ApiOkResponse({ type: PrintableDirectoryDeliveryResponseDto })
  @ApiOperation({ summary: "Record a delivery run's outcome" })
  reportResult(
    @Param('deliveryId') deliveryId: string,
    @Body() payload: ReportPrintableDirectoryDeliveryResultDto,
    @Req() request: Request,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    return this.deliveryService.reportResult(
      request.tenantId,
      deliveryId,
      payload,
    );
  }

  @Get(':deliveryId/preview')
  @ApiOkResponse({ type: PrintableDirectoryPreviewResponseDto })
  @ApiOperation({
    summary: "Build the delivery's directory preview",
    description:
      "Resolves the directory's resources as its owner (favorites lists included). Defaults to the delivery's locale.",
  })
  preview(
    @Param('deliveryId') deliveryId: string,
    @Query() query: PrintableDirectoryPreviewQueryDto,
    @Req() request: Request,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<PrintableDirectoryPreviewResponseDto> {
    return this.deliveryService.previewForDelivery(
      request.tenantId,
      deliveryId,
      query.locale,
      headers,
    );
  }
}

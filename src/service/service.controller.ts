import { Controller, Get, Param, UseGuards, Version } from '@nestjs/common';
import { ApiHeader, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ApiLocaleQuery, ApiTenantIdQuery } from 'src/common/decorators';
import { SetCdnCacheTTL } from 'src/common/decorators/cdn-cache-ttl.decorator';
import { FIFTEEN_MINUTES } from 'src/common/const';
import { ArcjetGuard } from 'src/common/guards/arcjet.guard';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import { ServiceDetailResponseDto } from './dto/service-detail-response.dto';
import { ServiceDetailService } from './service-detail.service';

@ApiTags('Service')
@Controller('service')
export class ServiceController {
  constructor(private readonly detailService: ServiceDetailService) {}

  @Get(':id')
  @Version('1')
  @UseGuards(ArcjetGuard)
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiTenantIdQuery()
  @ApiLocaleQuery()
  @ApiHeader({
    name: 'accept-language',
    required: true,
    description:
      'Selects which translations are returned. Falls back to English, then to the canonical locale.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiParam({ name: 'id', description: 'HSDS serviceId' })
  @ApiResponse({ status: 200, type: ServiceDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Service not found for this tenant',
  })
  getServiceById(
    @Param('id') id: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.detailService.findById(id, { headers });
  }
}

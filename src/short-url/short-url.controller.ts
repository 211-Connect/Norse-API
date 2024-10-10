import { Body, Controller, Get, Param, Post, Version } from '@nestjs/common';
import { ShortUrlService } from './short-url.service';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { XTenantIdDto, xTenantIdSchema } from 'src/common/dto/headers.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Short URL')
@Controller('short-url')
export class ShortUrlController {
  constructor(private readonly shortUrlService: ShortUrlService) {}

  @Get(':id')
  @Version('1')
  getShortUrlById(
    @Param('id') id,
    @CustomHeaders('x-tenant-id', new ZodValidationPipe(xTenantIdSchema))
    tenantId: XTenantIdDto,
  ) {
    return this.shortUrlService.findById(id, { tenantId });
  }

  @Post()
  @Version('1')
  getOrCreateShortUrl(
    @Body('url') url,
    @CustomHeaders('x-tenant-id', new ZodValidationPipe(xTenantIdSchema))
    tenantId,
  ) {
    return this.shortUrlService.getOrCreateShortUrl(url, { tenantId });
  }
}

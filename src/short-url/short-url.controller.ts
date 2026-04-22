import { Body, Controller, Get, Param, Post, Version } from '@nestjs/common';
import { ShortUrlService } from './short-url.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Short URL')
@Controller('short-url')
export class ShortUrlController {
  constructor(private readonly shortUrlService: ShortUrlService) {}

  @Get(':id')
  @Version('1')
  getShortUrlById(@Param('id') id: string) {
    return this.shortUrlService.findById(id);
  }

  @Post()
  @Version('1')
  getOrCreateShortUrl(@Body('url') url: string) {
    return this.shortUrlService.getOrCreateShortUrl(url);
  }
}

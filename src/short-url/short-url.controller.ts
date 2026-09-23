import { Body, Controller, Get, Param, Post, Version } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ShortUrlService } from './short-url.service';
import { CreateShortUrlDto } from './dto/create-short-url.dto';
import { ShortUrlResponseDto } from './dto/short-url-response.dto';

@ApiTags('Short URL')
@Controller('short-url')
export class ShortUrlController {
  constructor(private readonly shortUrlService: ShortUrlService) {}

  @Get(':id')
  @Version('1')
  @ApiOperation({
    summary: 'Resolve a short URL',
    description: 'Looks up the original URL for a previously issued short ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'The short ID issued by `POST /short-url`',
    example: 'aBcD1234EfGh',
  })
  @ApiResponse({
    status: 200,
    description: 'The original URL for the given short ID',
    type: ShortUrlResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Short URL not found' })
  getShortUrlById(@Param('id') id: string) {
    return this.shortUrlService.findById(id);
  }

  @Post()
  @Version('1')
  @ApiOperation({
    summary: 'Get or create a short URL',
    description:
      'Returns the existing short URL for the given URL, or creates a new one if none exists yet.',
  })
  @ApiBody({ type: CreateShortUrlDto })
  @ApiResponse({
    status: 200,
    description: 'The short URL that was found or created',
    type: ShortUrlResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  getOrCreateShortUrl(@Body() dto: CreateShortUrlDto) {
    return this.shortUrlService.getOrCreateShortUrl(dto.url);
  }
}

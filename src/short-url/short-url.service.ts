import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { XTenantIdDto } from 'src/common/dto/headers.dto';
import { ShortenedUrl } from 'src/common/schemas/shortened-url.schema';
import { nanoid } from 'nanoid';

@Injectable()
export class ShortUrlService {
  constructor(
    @InjectModel(ShortenedUrl.name)
    private shortenedUrlModel: Model<ShortenedUrl>,
  ) {}

  async findById(id: string, options: { tenantId: XTenantIdDto }) {
    const shortenedUrl = await this.shortenedUrlModel.findOne({
      shortId: id,
      tenantId: options.tenantId,
    });

    if (!shortenedUrl) throw new NotFoundException();

    return {
      url: shortenedUrl.originalUrl,
    };
  }

  async getOrCreateShortUrl(url, options: { tenantId: XTenantIdDto }) {
    const shortenedUrl = await this.shortenedUrlModel.findOne({
      originalUrl: url,
      tenantId: options.tenantId,
    });

    if (shortenedUrl) {
      const origin = new URL(shortenedUrl?.originalUrl);
      return {
        url: `${origin.protocol}//${origin.host}/api/share/${shortenedUrl.shortId}`,
      };
    }

    const newShortenedUrl = new this.shortenedUrlModel({
      originalUrl: url,
      shortId: nanoid(12),
      tenantId: options.tenantId,
    });

    await newShortenedUrl.save();

    const origin = new URL(newShortenedUrl?.originalUrl);

    return {
      url: `${origin.protocol}//${origin.host}/api/share/${newShortenedUrl.shortId}`,
    };
  }
}

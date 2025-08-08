import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { XTenantIdDto } from 'src/common/dto/headers.dto';
import { ShortenedUrl } from 'src/common/schemas/shortened-url.schema';
import { nanoid } from 'nanoid';
import {
  ShortUrlResponse,
  CreateShortUrlOptions,
  FindShortUrlOptions,
} from './short-url.dto';

@Injectable()
export class ShortUrlService {
  private readonly logger = new Logger(ShortUrlService.name);
  private readonly shortIdLength: number = 12;
  private readonly maxRetries: number = 3;

  constructor(
    @InjectModel(ShortenedUrl.name)
    private shortenedUrlModel: Model<ShortenedUrl>,
  ) {}

  /**
   * Validate input string is not empty
   */
  private validateInput(input: string, fieldName: string): void {
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      throw new BadRequestException(
        `${fieldName} is required and cannot be empty`,
      );
    }
  }

  /**
   * Validate URL format
   */
  private validateUrl(url: string): void {
    try {
      const parsedUrl = new URL(url);

      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new BadRequestException('Only HTTP and HTTPS URLs are allowed');
      }

      // Basic hostname validation
      if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
        throw new BadRequestException('Invalid URL hostname');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid URL format');
    }
  }

  /**
   * Validate tenant ID
   */
  private validateTenantId(tenantId: XTenantIdDto): void {
    if (
      !tenantId ||
      (typeof tenantId === 'string' && tenantId.trim().length === 0)
    ) {
      throw new BadRequestException('Tenant ID is required');
    }
  }

  /**
   * Find shortened URL by original URL or short ID and tenant
   */
  private async findShortUrl(
    options: FindShortUrlOptions,
  ): Promise<ShortenedUrl | null> {
    const { tenantId, originalUrl, shortId } = options;

    if (!originalUrl && !shortId) {
      throw new BadRequestException(
        'Either originalUrl or shortId must be provided',
      );
    }

    const query: any = { tenantId };

    if (originalUrl) {
      query.originalUrl = originalUrl;
    } else if (shortId) {
      query.shortId = shortId;
    }

    return this.shortenedUrlModel.findOne(query).lean().exec();
  }

  /**
   * Build the complete short URL using the original URL's protocol and host
   */
  private buildShortUrl(originalUrl: string, shortId: string): string {
    const origin = new URL(originalUrl);
    return `${origin.protocol}//${origin.host}/api/share/${shortId}`;
  }

  /**
   * Get or create shortened URL using findOneAndUpdate with upsert
   * Handles collision detection for shortId generation
   */
  private async getOrCreateWithUpsert(
    originalUrl: string,
    tenantId: XTenantIdDto,
  ): Promise<{ shortId: string; isNew: boolean }> {
    let retries = 0;

    while (retries < this.maxRetries) {
      try {
        // First, try to find existing record
        const existing = await this.shortenedUrlModel
          .findOne({
            originalUrl,
            tenantId,
          })
          .lean()
          .exec();

        if (existing) {
          return { shortId: existing.shortId, isNew: false };
        }

        // Generate new shortId for creation
        const shortId = nanoid(this.shortIdLength);

        // Use upsert to handle race conditions for the same originalUrl
        const result = await this.shortenedUrlModel
          .findOneAndUpdate(
            {
              originalUrl,
              tenantId,
            },
            {
              $setOnInsert: {
                shortId,
                createdAt: new Date(),
              },
            },
            {
              upsert: true,
              new: true,
              lean: true,
            },
          )
          .exec();

        // Check if this is actually a new document or if another process created it
        const isNew = !existing && result.shortId === shortId;

        return { shortId: result.shortId, isNew };
      } catch (error) {
        // Handle duplicate key error on shortId (very rare but possible)
        if (error.code === 11000) {
          // If duplicate key is on shortId field, retry with new shortId
          if (error.message.includes('shortId')) {
            retries++;
            this.logger.warn(
              `Short ID collision detected during upsert, retrying... (${retries}/${this.maxRetries})`,
            );
            continue;
          }

          // If duplicate key is on originalUrl + tenantId, another process created it
          // Try to find the existing record
          const existing = await this.shortenedUrlModel
            .findOne({
              originalUrl,
              tenantId,
            })
            .lean()
            .exec();

          if (existing) {
            return { shortId: existing.shortId, isNew: false };
          }
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'Failed to generate unique short ID after multiple attempts',
    );
  }

  /**
   * Find a shortened URL by its short ID
   * @param id - The short ID to lookup
   * @param options - Options containing tenant ID
   * @returns The original URL
   * @throws NotFoundException if the short URL doesn't exist
   */
  async findById(
    id: string,
    options: CreateShortUrlOptions,
  ): Promise<ShortUrlResponse> {
    this.validateInput(id, 'Short ID');
    this.validateTenantId(options.tenantId);

    try {
      const shortenedUrl = await this.findShortUrl({
        tenantId: options.tenantId,
        shortId: id,
      });

      if (!shortenedUrl) {
        this.logger.warn(
          `Short URL not found: ${id} for tenant: ${options.tenantId}`,
        );
        throw new NotFoundException('Short URL not found');
      }

      this.logger.debug(
        `Retrieved short URL: ${id} -> ${shortenedUrl.originalUrl}`,
      );

      return {
        url: shortenedUrl.originalUrl,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Error finding short URL by ID: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve short URL');
    }
  }

  /**
   * Get existing short URL or create a new one
   * @param originalUrl - The original URL to shorten
   * @param options - Options containing tenant ID
   * @returns The shortened URL
   * @throws BadRequestException if the URL is invalid
   */
  async getOrCreateShortUrl(
    originalUrl: string,
    options: CreateShortUrlOptions,
  ): Promise<ShortUrlResponse> {
    this.validateInput(originalUrl, 'URL');
    this.validateUrl(originalUrl);
    this.validateTenantId(options.tenantId);

    try {
      // Check if shortened URL already exists
      const shortenedUrl = await this.getOrCreateWithUpsert(
        originalUrl,
        options.tenantId,
      );
      this.logger.debug(
        `${shortenedUrl.isNew ? 'Created new' : 'Found existing'} short URL: ${originalUrl} -> ${shortenedUrl.shortId}`,
      );

      return {
        url: this.buildShortUrl(originalUrl, shortenedUrl.shortId),
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Error creating/retrieving short URL for: ${originalUrl}`,
        error.stack,
      );

      throw new InternalServerErrorException(
        'Failed to process short URL request',
      );
    }
  }
}

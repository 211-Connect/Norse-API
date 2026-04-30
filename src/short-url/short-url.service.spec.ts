import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShortUrlService } from './short-url.service';
import { ShortenedUrl } from 'src/common/schemas/shortened-url.schema';

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'generated-short-id'),
}));

describe('ShortUrlService', () => {
  let service: ShortUrlService;
  let model: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShortUrlService,
        {
          provide: getModelToken(ShortenedUrl.name),
          useValue: model,
        },
      ],
    }).compile();

    service = module.get<ShortUrlService>(ShortUrlService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds public share URLs without the api prefix', async () => {
    model.findOne.mockReturnValueOnce({
      lean: () => ({
        exec: async () => null,
      }),
    });
    model.findOneAndUpdate.mockReturnValueOnce({
      exec: async () => ({ shortId: 'abc123' }),
    });

    await expect(
      service.getOrCreateShortUrl('https://example.org/resource/1'),
    ).resolves.toEqual({
      url: 'https://example.org/share/abc123',
    });
  });

  it('looks up short URLs by shortId without tenant scoping', async () => {
    model.findOne.mockReturnValueOnce({
      lean: () => ({
        exec: async () => ({
          originalUrl: 'https://example.org/resource/1',
          shortId: 'abc123',
        }),
      }),
    });

    await expect(service.findById('abc123')).resolves.toEqual({
      url: 'https://example.org/resource/1',
    });
    expect(model.findOne).toHaveBeenCalledWith({ shortId: 'abc123' });
  });

  it('rejects invalid URLs before attempting persistence', async () => {
    await expect(service.getOrCreateShortUrl('not-a-url')).rejects.toThrow(
      BadRequestException,
    );
    expect(model.findOne).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('throws not found when a shortId does not exist', async () => {
    model.findOne.mockReturnValueOnce({
      lean: () => ({
        exec: async () => null,
      }),
    });

    await expect(service.findById('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

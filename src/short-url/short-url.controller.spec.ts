import { Test, TestingModule } from '@nestjs/testing';
import { ShortUrlController } from './short-url.controller';
import { ShortUrlService } from './short-url.service';

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'generated-short-id'),
}));

describe('ShortUrlController', () => {
  let controller: ShortUrlController;
  const mockShortUrlService = {
    findById: jest.fn(),
    getOrCreateShortUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShortUrlController],
      providers: [
        {
          provide: ShortUrlService,
          useValue: mockShortUrlService,
        },
      ],
    }).compile();

    controller = module.get<ShortUrlController>(ShortUrlController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards short ID lookups without tenant headers', async () => {
    mockShortUrlService.findById.mockResolvedValueOnce({
      url: 'https://example.org/resource/1',
    });

    await expect(controller.getShortUrlById('abc123')).resolves.toEqual({
      url: 'https://example.org/resource/1',
    });
    expect(mockShortUrlService.findById).toHaveBeenCalledWith('abc123');
  });

  it('creates short URLs from the request body URL', async () => {
    mockShortUrlService.getOrCreateShortUrl.mockResolvedValueOnce({
      url: 'https://example.org/share/abc123',
    });

    await expect(
      controller.getOrCreateShortUrl('https://example.org/resource/1'),
    ).resolves.toEqual({
      url: 'https://example.org/share/abc123',
    });
    expect(mockShortUrlService.getOrCreateShortUrl).toHaveBeenCalledWith(
      'https://example.org/resource/1',
    );
  });
});

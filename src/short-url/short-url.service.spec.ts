import { Test, TestingModule } from '@nestjs/testing';
import { ShortUrlService } from './short-url.service';

describe('ShortUrlService', () => {
  let service: ShortUrlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShortUrlService],
    }).compile();

    service = module.get<ShortUrlService>(ShortUrlService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

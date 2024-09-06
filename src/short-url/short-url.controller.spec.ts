import { Test, TestingModule } from '@nestjs/testing';
import { ShortUrlController } from './short-url.controller';
import { ShortUrlService } from './short-url.service';

describe('ShortUrlController', () => {
  let controller: ShortUrlController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShortUrlController],
      providers: [ShortUrlService],
    }).compile();

    controller = module.get<ShortUrlController>(ShortUrlController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

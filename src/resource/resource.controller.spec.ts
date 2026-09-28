import { Test, TestingModule } from '@nestjs/testing';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';

describe('ResourceController', () => {
  let controller: ResourceController;

  const resourceServiceMock = {
    findById: jest.fn(),
    findByOriginalId: jest.fn(),
    findTitlesByIds: jest.fn(),
    findManyByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        {
          provide: ResourceService,
          useValue: resourceServiceMock,
        },
      ],
    }).compile();

    controller = module.get<ResourceController>(ResourceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

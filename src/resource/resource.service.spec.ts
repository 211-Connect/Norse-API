import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ResourceService } from './resource.service';
import { Resource } from 'src/common/schemas/resource.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';

describe('ResourceService', () => {
  let service: ResourceService;

  const mockResourceModel = {};
  const mockRedirectModel = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: getModelToken(Resource.name),
          useValue: mockResourceModel,
        },
        {
          provide: getModelToken(Redirect.name),
          useValue: mockRedirectModel,
        },
      ],
    }).compile();

    service = module.get<ResourceService>(ResourceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { PrintableDirectoryPublicController } from './printable-directory-public.controller';
import { PrintableDirectoryService } from './printable-directory.service';

describe('PrintableDirectoryPublicController', () => {
  let controller: PrintableDirectoryPublicController;
  let service: PrintableDirectoryService;

  const mockService = {
    previewBySlug: jest.fn(),
  };

  const request = {
    tenantId: 'tenant-1',
  } as any;

  const headers = {
    'x-tenant-id': 'tenant-1',
    'accept-language': 'en',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrintableDirectoryPublicController],
      providers: [
        {
          provide: PrintableDirectoryService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PrintableDirectoryPublicController>(
      PrintableDirectoryPublicController,
    );
    service = module.get<PrintableDirectoryService>(PrintableDirectoryService);
    jest.clearAllMocks();
  });

  it('delegates slug-based preview using the request tenant, with no user scoping', async () => {
    mockService.previewBySlug.mockResolvedValue({ directoryId: 'directory-1' });

    const result = await controller.preview(
      'shelter-guide',
      { locale: 'en' },
      request,
      headers,
    );

    expect(service.previewBySlug).toHaveBeenCalledWith(
      'shelter-guide',
      'tenant-1',
      'en',
      headers,
    );
    expect(result).toEqual({ directoryId: 'directory-1' });
  });
});

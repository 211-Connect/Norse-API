import { Test, TestingModule } from '@nestjs/testing';
import { PrintableDirectoryController } from './printable-directory.controller';
import { PrintableDirectoryService } from './printable-directory.service';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';

describe('PrintableDirectoryController', () => {
  let controller: PrintableDirectoryController;
  let service: PrintableDirectoryService;

  const mockService = {
    list: jest.fn(),
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createSection: jest.fn(),
    updateSection: jest.fn(),
    removeSection: jest.fn(),
    reorderSections: jest.fn(),
    createSource: jest.fn(),
    updateSource: jest.fn(),
    removeSource: jest.fn(),
    reorderSources: jest.fn(),
    preview: jest.fn(),
  };

  const request = {
    tenantId: 'tenant-1',
  } as any;

  const user = {
    id: 'user-1',
  };

  beforeEach(async () => {
    const moduleRef = Test.createTestingModule({
      controllers: [PrintableDirectoryController],
      providers: [
        {
          provide: PrintableDirectoryService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(KeycloakGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) });

    const module: TestingModule = await moduleRef.compile();

    controller = module.get<PrintableDirectoryController>(
      PrintableDirectoryController,
    );
    service = module.get<PrintableDirectoryService>(PrintableDirectoryService);
    jest.clearAllMocks();
  });

  it('delegates list with user + tenant scope', async () => {
    mockService.list.mockResolvedValue({ total: 0, page: 1, items: [] });

    await controller.list({ page: 1, limit: 20 }, request, user);

    expect(service.list).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    );
  });

  it('delegates directory CRUD endpoints', async () => {
    mockService.create.mockResolvedValue({ id: 'directory-1' });
    mockService.getById.mockResolvedValue({ id: 'directory-1' });
    mockService.update.mockResolvedValue({ id: 'directory-1' });
    mockService.remove.mockResolvedValue(undefined);

    await controller.create({ name: 'Dir' }, request, user);
    await controller.getById('directory-1', request, user);
    await controller.update('directory-1', { name: 'Dir 2' }, request, user);
    const removeResult = await controller.remove('directory-1', request, user);

    expect(service.create).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalled();
    expect(service.update).toHaveBeenCalled();
    expect(service.remove).toHaveBeenCalledWith('directory-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(removeResult).toEqual({ success: true });
  });

  it('delegates section and source endpoints', async () => {
    mockService.createSection.mockResolvedValue({ id: 'directory-1' });
    mockService.updateSection.mockResolvedValue({ id: 'directory-1' });
    mockService.removeSection.mockResolvedValue({ id: 'directory-1' });
    mockService.reorderSections.mockResolvedValue({ id: 'directory-1' });
    mockService.createSource.mockResolvedValue({ id: 'directory-1' });
    mockService.updateSource.mockResolvedValue({ id: 'directory-1' });
    mockService.removeSource.mockResolvedValue({ id: 'directory-1' });
    mockService.reorderSources.mockResolvedValue({ id: 'directory-1' });

    await controller.createSection(
      'directory-1',
      {
        headingLocalized: { values: { en: 'A' } },
        descriptionLocalized: { values: { en: 'Desc' } },
      },
      request,
      user,
    );
    await controller.updateSection(
      'directory-1',
      'section-1',
      { headingLocalized: { values: { en: 'B' } } },
      request,
      user,
    );
    await controller.removeSection('directory-1', 'section-1', request, user);
    await controller.reorderSections(
      'directory-1',
      { sectionIds: ['section-1'] },
      request,
      user,
    );

    await controller.createSource(
      'directory-1',
      'section-1',
      { type: 'resource_ids', resourceIds: ['resource-1'] },
      request,
      user,
    );
    await controller.updateSource(
      'directory-1',
      'section-1',
      'source-1',
      { resourceIds: ['resource-2'] },
      request,
      user,
    );
    await controller.removeSource(
      'directory-1',
      'section-1',
      'source-1',
      request,
      user,
    );
    await controller.reorderSources(
      'directory-1',
      'section-1',
      { sourceIds: ['source-1'] },
      request,
      user,
    );

    expect(service.createSection).toHaveBeenCalled();
    expect(service.updateSection).toHaveBeenCalled();
    expect(service.removeSection).toHaveBeenCalled();
    expect(service.reorderSections).toHaveBeenCalled();
    expect(service.createSource).toHaveBeenCalled();
    expect(service.updateSource).toHaveBeenCalled();
    expect(service.removeSource).toHaveBeenCalled();
    expect(service.reorderSources).toHaveBeenCalled();
  });

  it('delegates preview with locale and headers', async () => {
    mockService.preview.mockResolvedValue({ directoryId: 'directory-1' });

    await controller.preview('directory-1', { locale: 'en' }, request, user, {
      'x-tenant-id': 'tenant-1',
      'accept-language': 'en',
    });

    expect(service.preview).toHaveBeenCalledWith(
      'directory-1',
      'en',
      { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' },
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    );
  });
});

// `@arcjet/nest` ships ESM only; the guard decorator only needs the token.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { createUsageMetricsServiceMock } from 'src/metrics/testing/usage-metrics-service.mock';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';

describe('ResourceController', () => {
  let controller: ResourceController;
  let usageMetrics: { recordResourceRequest: jest.Mock };

  const resourceServiceMock = {
    findById: jest.fn(),
    findByOriginalId: jest.fn(),
    findTitlesByIds: jest.fn(),
    findManyByIds: jest.fn(),
  };

  const headers = { 'x-tenant-id': 'tenant-1', 'accept-language': 'es' };
  const req = {
    tenantId: 'tenant-1',
    headers: { 'accept-language': 'es-MX' },
  } as unknown as Request;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        {
          provide: ResourceService,
          useValue: resourceServiceMock,
        },
        {
          provide: UsageMetricsService,
          useValue: createUsageMetricsServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<ResourceController>(ResourceController);
    usageMetrics = module.get(
      UsageMetricsService,
    ) as unknown as typeof usageMetrics;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('records a found outcome for a resolved lookup', async () => {
    resourceServiceMock.findById.mockResolvedValue({ id: 'resource-1' });

    await controller.getResourceById('id-1', headers, req);

    expect(usageMetrics.recordResourceRequest).toHaveBeenCalledTimes(1);
    expect(usageMetrics.recordResourceRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', acceptLanguage: 'es-MX' },
      'found',
    );
  });

  it('records not_found for a 404 and rethrows', async () => {
    resourceServiceMock.findByOriginalId.mockRejectedValue(
      new NotFoundException(),
    );

    await expect(
      controller.getResourceByOriginalId('id-1', headers, req),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(usageMetrics.recordResourceRequest).toHaveBeenCalledTimes(1);
    expect(usageMetrics.recordResourceRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', acceptLanguage: 'es-MX' },
      'not_found',
    );
  });

  it('records error for an unexpected failure', async () => {
    resourceServiceMock.findById.mockRejectedValue(new Error('mongo down'));

    await expect(
      controller.getResourceById('id-1', headers, req),
    ).rejects.toThrow('mongo down');

    expect(usageMetrics.recordResourceRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', acceptLanguage: 'es-MX' },
      'error',
    );
  });
});

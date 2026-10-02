import { Test } from '@nestjs/testing';
import { TracingShutdownService } from './tracing-shutdown.service';
import { shutdownTracing } from 'src/tracing';

jest.mock('src/tracing', () => ({
  shutdownTracing: jest.fn().mockResolvedValue(undefined),
}));

describe('TracingShutdownService', () => {
  let service: TracingShutdownService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [TracingShutdownService],
    }).compile();
    service = module.get<TracingShutdownService>(TracingShutdownService);
  });

  it('calls shutdownTracing exactly once and resolves', async () => {
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(shutdownTracing).toHaveBeenCalledTimes(1);
  });
});

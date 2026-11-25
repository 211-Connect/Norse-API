import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiSearchService, ML_BROKER_TOP_K } from './ai-search.service';
import { HybridSearchService } from './hybrid-search.service';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = {
  'x-tenant-id': 'default',
  'accept-language': 'en',
};

describe('AiSearchService', () => {
  let service: AiSearchService;

  beforeEach(async () => {
    jest.restoreAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSearchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ML_BROKER_BASE_URL') return 'https://broker.example';
              if (key === 'ML_BROKER_API_KEY') return 'secret-key';
              return undefined;
            }),
          },
        },
        {
          provide: HybridSearchService,
          useValue: {
            embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            getDocumentsCount: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
      ],
    }).compile();

    service = module.get<AiSearchService>(AiSearchService);
  });

  it('returns search for high confidence single category', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        task: 'needs-classification',
        query: 'childrens hospital',
        tenant_id: 'default',
        low_info: {
          is_low_info: false,
          reason: 'none',
          score: 0,
          matched_pattern: null,
        },
        confidence: {
          level: 'high',
          top_score: 0.99,
          top_labels: ['Health Care'],
          multiple_high_confidence: false,
          high_threshold: 0.5,
        },
        needs: [
          {
            code: 'HC-300',
            name: 'Health Care',
            description: 'desc',
            score: 0.99,
          },
        ],
        hsis_taxonomies: ['L'],
      }),
    } as Response);

    const fetchSpy = jest.spyOn(global, 'fetch' as any);

    const result = await service.predict(headers as any, {
      query: 'childrens hospital',
    });

    const [, requestOptions] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const parsedBody = JSON.parse(String(requestOptions.body));
    expect(parsedBody.top_k).toBe(ML_BROKER_TOP_K);

    expect(result.scenario).toBe('search');
    expect(result.hsis_taxonomies).toEqual(['L']);
    expect(result.options).toEqual([
      {
        code: 'HC-300',
        score: 0.99,
        pre_selected: true,
        results_count: 0,
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns clarify for high confidence ambiguous categories', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: 'needs-classification',
          query: 'need help',
          tenant_id: 'default',
          low_info: {
            is_low_info: false,
            reason: 'none',
            score: 0,
            matched_pattern: null,
          },
          confidence: {
            level: 'high',
            top_score: 0.78,
            top_labels: ['Housing', 'Utilities'],
            multiple_high_confidence: true,
            high_threshold: 0.5,
          },
          needs: [
            { code: 'BH-1800', name: 'Housing', score: 0.78 },
            { code: 'BV-8900', name: 'Utilities', score: 0.75 },
          ],
          hsis_taxonomies: ['BH', 'BV'],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hsis_taxonomies: ['BH-100', 'BH-200'] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hsis_taxonomies: ['BV-300'] }),
      } as Response);

    const hybridService = (service as any)
      .hybridSearchService as HybridSearchService;
    const getDocumentsCountSpy = jest
      .spyOn(hybridService, 'getDocumentsCount')
      .mockResolvedValueOnce(127)
      .mockResolvedValueOnce(209);

    const result = await service.predict(headers as any, {
      query: 'need help',
    });

    expect(result.scenario).toBe('clarify_multiple_labels');
    expect(result.hsis_taxonomies).toEqual(['BH', 'BV']);
    expect(result.options).toHaveLength(2);
    expect(result.options).toEqual([
      {
        code: 'BH-1800',
        score: 0.78,
        pre_selected: true,
        results_count: 127,
      },
      {
        code: 'BV-8900',
        score: 0.75,
        pre_selected: true,
        results_count: 209,
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(getDocumentsCountSpy).toHaveBeenNthCalledWith(
      1,
      headers,
      'need help',
      ['BH-100', 'BH-200'],
    );
    expect(getDocumentsCountSpy).toHaveBeenNthCalledWith(
      2,
      headers,
      'need help',
      ['BV-300'],
    );
  });

  it('returns search_and_notify when low_info is true and single top label', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        task: 'needs-classification',
        query: 'help',
        tenant_id: 'default',
        low_info: {
          is_low_info: true,
          reason: 'exact_pattern',
          score: 1,
          matched_pattern: 'help',
        },
        confidence: {
          level: 'high',
          top_score: 0.55,
          top_labels: ['Housing'],
          multiple_high_confidence: false,
          high_threshold: 0.5,
        },
        needs: [{ code: 'BH-1800', name: 'Housing', score: 0.55 }],
        hsis_taxonomies: ['BH'],
      }),
    } as Response);

    const result = await service.predict(headers as any, {
      query: 'help',
    });

    expect(result.scenario).toBe('search_and_notify_low_info');
    expect(result.hsis_taxonomies).toEqual(['BH']);
    expect(result.options).toEqual([
      {
        code: 'BH-1800',
        score: 0.55,
        pre_selected: false,
        results_count: 0,
      },
    ]);
  });

  it('falls back to zero results_count when clarify enrichment fails', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: 'needs-classification',
          query: 'need help',
          tenant_id: 'default',
          low_info: {
            is_low_info: false,
            reason: 'none',
            score: 0,
            matched_pattern: null,
          },
          confidence: {
            level: 'high',
            top_score: 0.78,
            top_labels: ['Housing'],
            multiple_high_confidence: true,
            high_threshold: 0.5,
          },
          needs: [{ code: 'BH-1800', name: 'Housing', score: 0.78 }],
          hsis_taxonomies: ['BH'],
        }),
      } as Response)
      .mockRejectedValueOnce(new Error('re-rank unavailable'));

    const result = await service.predict(headers as any, {
      query: 'need help',
    });

    expect(result.scenario).toBe('clarify_multiple_labels');
    expect(result.options).toEqual([
      {
        code: 'BH-1800',
        score: 0.78,
        pre_selected: true,
        results_count: 0,
      },
    ]);
  });

  it('returns search_and_notify for low confidence', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        task: 'needs-classification',
        query: 'i need things',
        tenant_id: 'default',
        low_info: {
          is_low_info: false,
          reason: 'none',
          score: 0,
          matched_pattern: null,
        },
        confidence: {
          level: 'low',
          top_score: 0.29,
          top_labels: [],
          multiple_high_confidence: false,
          high_threshold: 0.5,
        },
        needs: [],
        hsis_taxonomies: [],
      }),
    } as Response);

    const result = await service.predict(headers as any, {
      query: 'i need things',
    });

    expect(result.scenario).toBe('search_and_notify_low_confidence');
    expect(result.hsis_taxonomies).toEqual([]);
    expect(result.options).toHaveLength(0);
  });

  it('returns clarify for low_info query with multiple top labels', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        task: 'needs-classification',
        query: 'help',
        tenant_id: 'default',
        low_info: {
          is_low_info: true,
          reason: 'exact_pattern',
          score: 1,
          matched_pattern: 'help',
        },
        confidence: {
          level: 'high',
          top_score: 0.65,
          top_labels: ['Housing', 'Utilities'],
          multiple_high_confidence: true,
          high_threshold: 0.5,
        },
        needs: [
          { code: 'BH-1800', name: 'Housing', score: 0.65 },
          { code: 'BV-8900', name: 'Utilities', score: 0.62 },
        ],
        hsis_taxonomies: ['BH', 'BV'],
      }),
    } as Response);

    const result = await service.predict(headers as any, {
      query: 'help',
    });

    expect(result.scenario).toBe('clarify_low_info');
    expect(result.hsis_taxonomies).toEqual(['BH', 'BV']);
    expect(result.options).toHaveLength(2);
    expect(result.options[0].code).toBe('BH-1800');
  });

  it('throws BadGatewayException when broker responds with non-2xx', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    } as Response);

    await expect(
      service.predict(headers as any, { query: 'rent help' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws ServiceUnavailableException on timeout', async () => {
    jest
      .spyOn(global, 'fetch' as any)
      .mockRejectedValue({ name: 'AbortError' });

    await expect(
      service.predict(headers as any, { query: 'rent help' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('forwards re-rank need_weights directly', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        hsis_taxonomies: ['BH-3800', 'BT-4500.4500-050'],
      }),
    } as Response);

    const result = await service.reRank(headers as any, {
      need_weights: {
        'HO-300': 0.907,
        'IC-330': 0.0817,
      },
    });

    expect(result).toEqual({
      hsis_taxonomies: ['BH-3800', 'BT-4500.4500-050'],
    });

    const [calledUrl, requestOptions] = fetchSpy.mock.calls[0] as [
      unknown,
      RequestInit,
    ];
    expect(String(calledUrl)).toContain('/re-rank');
    const parsedBody = JSON.parse(String(requestOptions.body));
    expect(parsedBody.top_k).toBe(ML_BROKER_TOP_K);
    expect(parsedBody.need_weights).toEqual({
      'HO-300': 0.907,
      'IC-330': 0.0817,
    });
  });
});

describe('AiSearchService v1 broker URL (ML_BROKER_V1_BASE_URL)', () => {
  const lowInfoReply = {
    task: 'needs-classification',
    query: 'rent help',
    tenant_id: 'default',
    low_info: {
      is_low_info: true,
      reason: 'x',
      score: 0,
      matched_pattern: null,
    },
    confidence: {
      level: 'low',
      top_score: 0.1,
      top_labels: [],
      multiple_high_confidence: false,
    },
    needs: [],
    hsis_taxonomies: [],
  };

  const build = async (config: Record<string, string>) => {
    const module = await Test.createTestingModule({
      providers: [
        AiSearchService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
        {
          provide: HybridSearchService,
          useValue: { embedQuery: jest.fn(), getDocumentsCount: jest.fn() },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();
    return module.get(AiSearchService);
  };

  const run = async (config: Record<string, string>) => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => lowInfoReply,
    } as Response);
    const service = await build(config);
    await service.predict(headers as any, { query: 'rent help' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    return { url, key: (init.headers as any)['x-api-key'] };
  };

  beforeEach(() => jest.restoreAllMocks());

  const shared = {
    ML_BROKER_BASE_URL: 'https://broker.shared',
    ML_BROKER_API_KEY: 'shared-key',
  };

  it('unset: v1 predict uses ML_BROKER_BASE_URL and ML_BROKER_API_KEY', async () => {
    const { url, key } = await run(shared);
    expect(url).toBe(
      'https://broker.shared/api/v1/tasks/needs-classification/predict',
    );
    expect(key).toBe('shared-key');
  });

  it('set: v1 predict goes to the v1 URL; the key falls back to the shared key', async () => {
    const { url, key } = await run({
      ...shared,
      ML_BROKER_V1_BASE_URL: 'https://broker.v1',
    });
    expect(url).toBe(
      'https://broker.v1/api/v1/tasks/needs-classification/predict',
    );
    expect(key).toBe('shared-key');
  });

  it('set with its own key: v1 predict sends the v1 key', async () => {
    const { url, key } = await run({
      ...shared,
      ML_BROKER_V1_BASE_URL: 'https://broker.v1',
      ML_BROKER_V1_API_KEY: 'v1-key',
    });
    expect(url).toContain('https://broker.v1/');
    expect(key).toBe('v1-key');
  });

  it('v1 key alone does not change the URL', async () => {
    const { url, key } = await run({
      ...shared,
      ML_BROKER_V1_API_KEY: 'v1-key',
    });
    expect(url).toContain('https://broker.shared/');
    expect(key).toBe('v1-key');
  });

  it('empty v1 values count as unset', async () => {
    const { url, key } = await run({
      ...shared,
      ML_BROKER_V1_BASE_URL: '',
      ML_BROKER_V1_API_KEY: '',
    });
    expect(url).toContain('https://broker.shared/');
    expect(key).toBe('shared-key');
  });

  it('v1 URL set but no key anywhere: still not configured (503)', async () => {
    const service = await build({ ML_BROKER_V1_BASE_URL: 'https://broker.v1' });
    await expect(
      service.predict(headers as any, { query: 'rent help' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

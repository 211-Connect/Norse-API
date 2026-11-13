// `@arcjet/nest` ships ESM only; the guard decorator only needs the token.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import { Request } from 'express';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { V2SearchController } from './v2-search.controller';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchService } from './v2-search.service';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';

const headers = { 'x-tenant-id': 't', 'accept-language': 'en' } as HeadersDto;
const req = {
  tenantId: 't',
  headers: { 'accept-language': 'en' },
} as unknown as Request;

describe('V2SearchController', () => {
  const build = (search: jest.Mock) => {
    const recordSearchRequest = jest.fn();
    const controller = new V2SearchController(
      { search } as unknown as V2SearchService,
      { recordSearchRequest } as unknown as UsageMetricsService,
    );
    return { controller, recordSearchRequest };
  };

  it('delegates to the service and records one v2 usage metric', async () => {
    const response = { search: { hits: { total: 3, hits: [] } } };
    const search = jest.fn().mockResolvedValue(response);
    const { controller, recordSearchRequest } = build(search);
    const query = new V2SearchQueryDto();

    await expect(controller.getResources(headers, query, req)).resolves.toBe(
      response,
    );
    // No server-readable tenant setting yet: the route sends the default "on".
    expect(search).toHaveBeenCalledWith({
      headers,
      query,
      aiClassification: 'on',
    });
    expect(recordSearchRequest).toHaveBeenCalledTimes(1);
    expect(recordSearchRequest).toHaveBeenCalledWith(
      { tenantId: 't', acceptLanguage: 'en' },
      'v2',
      'results',
    );
  });

  it('records zero_results for an empty hit list', async () => {
    const { controller, recordSearchRequest } = build(
      jest.fn().mockResolvedValue({ search: { hits: { total: 0, hits: [] } } }),
    );
    await controller.getResources(headers, new V2SearchQueryDto(), req);
    expect(recordSearchRequest.mock.calls[0][2]).toBe('zero_results');
  });

  it('records error once and rethrows when the service fails', async () => {
    const boom = new Error('boom');
    const { controller, recordSearchRequest } = build(
      jest.fn().mockRejectedValue(boom),
    );
    await expect(
      controller.getResources(headers, new V2SearchQueryDto(), req),
    ).rejects.toBe(boom);
    expect(recordSearchRequest).toHaveBeenCalledTimes(1);
    expect(recordSearchRequest.mock.calls[0][2]).toBe('error');
  });

  describe('getResourcesPost', () => {
    const postReq = {
      tenantId: 't',
      headers: { 'accept-language': 'en', 'content-type': 'application/json' },
    } as unknown as Request;
    const body = { geometry: { type: 'Point', coordinates: [1, 2] } };

    it('delegates with the body and records one v2 usage metric', async () => {
      const response = { search: { hits: { total: 3, hits: [] } } };
      const search = jest.fn().mockResolvedValue(response);
      const { controller, recordSearchRequest } = build(search);
      const query = new V2SearchQueryDto();

      await expect(
        controller.getResourcesPost(headers, query, body as never, postReq),
      ).resolves.toBe(response);
      expect(search).toHaveBeenCalledWith({
        headers,
        query,
        body,
        aiClassification: 'on',
      });
      expect(recordSearchRequest).toHaveBeenCalledTimes(1);
      expect(recordSearchRequest).toHaveBeenCalledWith(
        { tenantId: 't', acceptLanguage: 'en' },
        'v2',
        'results',
      );
    });

    it('rejects a non-JSON content type with 400 and calls nothing', async () => {
      const search = jest.fn();
      const { controller, recordSearchRequest } = build(search);
      const badReq = {
        tenantId: 't',
        headers: { 'content-type': 'text/plain' },
      } as unknown as Request;
      await expect(
        controller.getResourcesPost(
          headers,
          new V2SearchQueryDto(),
          body as never,
          badReq,
        ),
      ).rejects.toThrow('Content-Type must be application/json');
      expect(search).not.toHaveBeenCalled();
      expect(recordSearchRequest).not.toHaveBeenCalled();
    });
  });
});

import {
  BadGatewayException,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errors } from '@elastic/elasticsearch';
import { callElasticsearch } from './es-call';

describe('callElasticsearch', () => {
  const logger = { error: jest.fn() } as unknown as Logger;
  const options = { label: 'Thing search', logger };
  const reject = (error: unknown) => () => Promise.reject(error);
  const timeout = () =>
    new errors.TimeoutError('Request timed out', {} as never);

  it('returns the result of a successful call', async () => {
    await expect(callElasticsearch(options, async () => 42)).resolves.toBe(42);
  });

  it('rethrows an HttpException unchanged', async () => {
    const notFound = new NotFoundException('gone');
    await expect(callElasticsearch(options, reject(notFound))).rejects.toBe(
      notFound,
    );
  });

  it('maps a timeout to 503 naming the call', async () => {
    const failure = callElasticsearch(options, reject(timeout()));
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.toThrow('Thing search timed out');
  });

  it('maps any other failure to 502 naming the call', async () => {
    const failure = callElasticsearch(options, reject(new Error('boom')));
    await expect(failure).rejects.toBeInstanceOf(BadGatewayException);
    await expect(failure).rejects.toThrow('Thing search failed');
  });

  it('lets the mapper claim an error before the defaults', async () => {
    const mapError = (e: unknown) =>
      e instanceof Error && e.message === 'mine'
        ? new BadRequestException('mapped')
        : null;
    await expect(
      callElasticsearch({ ...options, mapError }, reject(new Error('mine'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      callElasticsearch({ ...options, mapError }, reject(new Error('other'))),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      callElasticsearch({ ...options, mapError }, reject(timeout())),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

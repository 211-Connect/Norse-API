import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './global-exception.filter';

function host(originalUrl: string): ArgumentsHost {
  const res = { status: () => res, json: () => res };
  const req = { method: 'GET', originalUrl, url: originalUrl, headers: {} };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
}

/**
 * A missing resource is routine (stale links), so its 404 logs at debug.
 * ISS-2496: the same holds when the caller sends the version in the path.
 */
describe('HttpExceptionFilter 404 log level', () => {
  let debug: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['/resource/abc', '/v1/resource/abc'])(
    'GET %s 404 logs at debug',
    (url) => {
      new HttpExceptionFilter().catch(new NotFoundException(), host(url));
      expect(debug).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('any other 404 logs at warn', () => {
    new HttpExceptionFilter().catch(new NotFoundException(), host('/nope'));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

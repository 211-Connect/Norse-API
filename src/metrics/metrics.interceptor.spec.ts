import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  let metricsMock: { recordHttpRequest: jest.Mock };
  let reflectorMock: { getAllAndOverride: jest.Mock };
  let interceptor: MetricsInterceptor;
  let subject: Subject<string>;

  const createContext = (
    headers: Record<string, string> = { 'x-tenant-id': 'tenant-1' },
    statusCode = 200,
  ): ExecutionContext =>
    ({
      getClass: () => ({ name: 'FakeController' }),
      getHandler: () => ({ name: 'fakeHandler' }),
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          headers,
          tenantId: 'tenant-1',
        }),
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    metricsMock = { recordHttpRequest: jest.fn() };
    reflectorMock = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    interceptor = new MetricsInterceptor(
      metricsMock as never,
      reflectorMock as never,
    );
    subject = new Subject<string>();
  });

  it('records one http request on success with handler, status, tenant and duration', (done) => {
    const next: CallHandler = { handle: () => of('value') };

    interceptor.intercept(createContext(), next).subscribe({
      next: (value) => expect(value).toBe('value'),
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '200',
          'tenant-1',
          expect.any(Number),
        );
        const duration = metricsMock.recordHttpRequest.mock.calls[0][5];
        expect(duration).toBeGreaterThanOrEqual(0);
        done();
      },
    });
  });

  it('records status 502 for a thrown HttpException and propagates the error', (done) => {
    const err = new HttpException('boom', 502);
    const next: CallHandler = { handle: () => throwError(() => err) };

    interceptor.intercept(createContext(), next).subscribe({
      error: (received) => {
        expect(received).toBe(err);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '502',
          'tenant-1',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records status 500 for a non-HttpException error and propagates it', (done) => {
    const err = new Error('kaboom');
    const next: CallHandler = { handle: () => throwError(() => err) };

    interceptor.intercept(createContext(), next).subscribe({
      error: (received) => {
        expect(received).toBe(err);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '500',
          'tenant-1',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('does not record metrics when the route is skipped and passes the stream through', (done) => {
    reflectorMock.getAllAndOverride.mockReturnValue(true);
    const next: CallHandler = { handle: () => of('skipped') };

    interceptor.intercept(createContext(), next).subscribe({
      next: (value) => expect(value).toBe('skipped'),
      complete: () => {
        expect(metricsMock.recordHttpRequest).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('falls back to tenant id unknown when TenantMiddleware did not set one', (done) => {
    const request = { method: 'GET', headers: {} };
    const context = createContext();
    context.switchToHttp = () =>
      ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }) as never;
    const next: CallHandler = { handle: () => of('value') };

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '200',
          'unknown',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('falls back to unknown when only the raw header is present and request.tenantId is not set', (done) => {
    const request = {
      method: 'GET',
      headers: { 'x-tenant-id': 'attacker-controlled-value' },
    };
    const context = createContext();
    context.switchToHttp = () =>
      ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }) as never;
    const next: CallHandler = { handle: () => of('value') };

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '200',
          'unknown',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('uses request.tenantId set by TenantMiddleware over the raw header', (done) => {
    const request = {
      method: 'GET',
      headers: { 'x-tenant-id': 'raw-unvalidated' },
      tenantId: 'validated-uuid',
    };
    const context = createContext();
    context.switchToHttp = () =>
      ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }) as never;
    const next: CallHandler = { handle: () => of('value') };

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '200',
          'validated-uuid',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records exactly once when the observable emits multiple values', (done) => {
    const next: CallHandler = { handle: () => of('a', 'b', 'c') };

    interceptor.intercept(createContext(), next).subscribe({
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        done();
      },
    });
  });

  it('records the response status for an empty observable', (done) => {
    const next: CallHandler = { handle: () => EMPTY };

    interceptor.intercept(createContext(), next).subscribe({
      complete: () => {
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
        expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController.fakeHandler',
          'fake',
          '200',
          'tenant-1',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records 499 when the subscriber unsubscribes before completion', () => {
    const next: CallHandler = { handle: () => subject };
    const subscription = interceptor
      .intercept(createContext(), next)
      .subscribe();

    subscription.unsubscribe();

    expect(metricsMock.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(metricsMock.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      'FakeController.fakeHandler',
      'fake',
      '499',
      'tenant-1',
      expect.any(Number),
    );
  });
});

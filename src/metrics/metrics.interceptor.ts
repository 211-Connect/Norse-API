import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';
import { SKIP_METRICS_KEY } from './skip-metrics.decorator';

/**
 * Records norse_http_requests_total and norse_http_request_duration_seconds
 * for every route that is not marked with @SkipMetrics().
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metrics: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_METRICS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method: string = request.method ?? 'UNKNOWN';
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const domain =
      context
        .getClass()
        .name.replace(/Controller$/, '')
        .toLowerCase() || 'unknown';
    // Use the tenant id validated by TenantMiddleware (request.tenantId).
    // The raw header is unbounded on controllers without TenantMiddleware.
    const tenantId =
      typeof request.tenantId === 'string' && request.tenantId
        ? request.tenantId
        : 'unknown';

    const start = performance.now();
    let recorded = false;

    const record = (status: number) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = (performance.now() - start) / 1000;
      this.metrics.recordHttpRequest(
        method,
        handler,
        domain,
        String(status),
        tenantId,
        durationSeconds,
      );
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          record(response?.statusCode ?? 200);
        },
        complete: () => {
          record(context.switchToHttp().getResponse()?.statusCode ?? 200);
        },
      }),
      catchError((err: unknown) => {
        record(err instanceof HttpException ? err.getStatus() : 500);
        return throwError(() => err);
      }),
      finalize(() => {
        // Client disconnected / subscriber never emitted — 499 (nginx convention).
        record(499);
      }),
    );
  }
}

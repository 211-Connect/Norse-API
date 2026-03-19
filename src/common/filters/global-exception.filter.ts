import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly securityLogger = new Logger('SecurityMonitor');

  private detectSuspiciousPatterns(url: string): boolean {
    const suspiciousPatterns = [
      /(\bSELECT\b|\bUNION\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b)/i,
      /(\bCAST\b.*\bAS\b|\bEXEC\b|\bEXECUTE\b)/i,
      /(--|\/\*|\*\/|;)/,
      /(\bOR\b.*=.*|\bAND\b.*=.*)/i,
      /(\|\|.*\(.*\))/,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(url));
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? ((exception.getResponse() as any)?.message ?? exception.message)
        : 'Internal server error';

    const url = req?.originalUrl || '';
    if (this.detectSuspiciousPatterns(url)) {
      this.securityLogger.warn(
        `Potential injection attempt detected: ${req?.method} ${req?.ip || 'unknown IP'} - Status: ${status}`,
        {
          tenant: req?.tenantId,
          method: req?.method,
          userAgent: req?.headers?.['user-agent'],
          urlLength: url.length,
        },
      );
    }

    if (status >= 500) {
      this.logger.error(
        `${req?.method} ${req?.originalUrl} - ${status} - ${message}`,
        exception instanceof Error ? exception.stack : exception,
      );
    } else if (
      status === 404 &&
      req?.method === 'GET' &&
      req.originalUrl.startsWith('/resource/')
    ) {
      this.logger.debug(
        `${req?.method} ${req?.originalUrl} - ${status} - ${message}`,
      );
    } else {
      this.logger.warn(
        `${req?.method} ${req?.originalUrl} - ${status} - ${message}`,
      );
    }

    const payload = {
      status,
      message,
      path: req?.originalUrl,
      method: req?.method,
      tenant: req?.tenantId,
    };

    res.status(status).json(payload);
  }
}

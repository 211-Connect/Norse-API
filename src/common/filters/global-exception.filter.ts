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

    if (status >= 500) {
      this.logger.error(
        `${req?.method} ${req?.originalUrl} - ${status} - ${message}`,
        exception instanceof Error ? exception.stack : exception,
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
      tenant: req?.tenant?.id,
    };

    res.status(status).json(payload);
  }
}

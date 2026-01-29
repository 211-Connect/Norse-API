import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = {
      status,
      message:
        exception instanceof HttpException
          ? ((exception.getResponse() as any)?.message ?? exception.message)
          : 'Internal server error',
      path: req?.originalUrl,
      method: req?.method,
      tenant: req?.tenant?.id,
    };

    res.status(status).json(payload);
  }
}

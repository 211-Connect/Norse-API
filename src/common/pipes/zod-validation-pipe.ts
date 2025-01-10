import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { error } from 'console';
import { ZodSchema, ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: any) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        throw new BadRequestException({
          message: 'Validation failed',
          errors: errors,
        });
      }
    }

    throw error;
  }
}

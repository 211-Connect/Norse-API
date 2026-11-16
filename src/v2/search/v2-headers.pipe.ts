import { Injectable, PipeTransform } from '@nestjs/common';
import { headersSchema } from '../../common/dto/headers.dto';
import { parseExactLanguage } from '../../common/locales';
import { ZodValidationPipe } from '../../common/pipes/zod-validation-pipe';

/**
 * Header pipe for /v2/search. `acceptLanguageSchema` keeps only the highest
 * weight entry of a list, so the exact-code check reads the raw header first.
 * A missing header is not checked here: `headersSchema` still rejects it (400,
 * as before). v1 does not use this pipe and stays lenient.
 */
@Injectable()
export class V2HeadersPipe implements PipeTransform {
  private readonly zod = new ZodValidationPipe(headersSchema);

  transform(value: Record<string, unknown>) {
    const raw = value?.['accept-language'];
    if (typeof raw === 'string') parseExactLanguage(raw);
    return this.zod.transform(value);
  }
}

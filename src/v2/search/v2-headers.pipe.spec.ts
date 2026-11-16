import { BadRequestException } from '@nestjs/common';
import { V2_ACCEPT_LANGUAGE_MESSAGE } from '../../common/locales';
import { V2HeadersPipe } from './v2-headers.pipe';

const tenant = '11111111-1111-4111-8111-111111111111';
const pipe = new V2HeadersPipe();
const headers = (lang?: string) => ({
  'x-tenant-id': tenant,
  ...(lang !== undefined && { 'accept-language': lang }),
});

describe('V2HeadersPipe', () => {
  it.each(['en', 'es', 'zh-Hans'])('accepts %s', (lang) => {
    expect(pipe.transform(headers(lang))['accept-language']).toBe(lang);
  });

  it.each(['en-US', 'en;q=0.9,es', 'es,en', 'xx', '*', ''])(
    'rejects %p with the exact message',
    (lang) => {
      const fail = () => pipe.transform(headers(lang));
      expect(fail).toThrow(BadRequestException);
      expect(fail).toThrow(V2_ACCEPT_LANGUAGE_MESSAGE);
    },
  );

  it('keeps the current behavior for a missing header: 400 from headersSchema', () => {
    const fail = () => pipe.transform(headers());
    expect(fail).toThrow(BadRequestException);
    expect(fail).toThrow(/accept-language/);
  });
});

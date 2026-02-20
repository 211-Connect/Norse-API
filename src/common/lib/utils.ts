import { HeadersDto } from 'src/common/dto/headers.dto';

// Function to construct Elasticsearch index name
export function getIndexName(headers: HeadersDto, index: string): string {
  const languageHeader = headers['accept-language'] ?? 'en';
  const tenantId = headers['x-tenant-id'] ?? undefined;

  // The accept-language header can be a comma-separated list.
  // Take the first, most preferred language and remove quality factors.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Language
  const preferredLanguage = languageHeader.split(',')[0].trim();

  const langParts = preferredLanguage.toLowerCase().split('-');
  const baseLang = langParts[0];

  let finalLang = baseLang;

  if (langParts.length > 1) {
    const secondPart = langParts[1];
    // A second part of 4 letters is a script (e.g., Latn), which we keep.
    // A second part of 2 letters is a region (e.g., US), which we discard
    // to match base language indices (e.g., 'en' from 'en-US').
    if (secondPart.length === 4) {
      finalLang = `${baseLang}-${secondPart}`;
    }
  }
  // Sanitize the final locale for the index name (e.g., 'zh-hans' -> 'zh_hans')
  const sanitizedLanguage = finalLang.replace('-', '_');

  const indexName = `${tenantId}-${index}_${sanitizedLanguage}`;
  return indexName;
}

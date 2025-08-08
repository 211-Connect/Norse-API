export interface ShortUrlResponse {
  url: string;
}

export interface CreateShortUrlOptions {
  tenantId: string;
}

export interface FindShortUrlOptions {
  tenantId: string;
  originalUrl?: string;
  shortId?: string;
}

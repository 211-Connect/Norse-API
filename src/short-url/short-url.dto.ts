export interface ShortUrlResponse {
  url: string;
}

export interface FindShortUrlOptions {
  originalUrl?: string;
  shortId?: string;
}

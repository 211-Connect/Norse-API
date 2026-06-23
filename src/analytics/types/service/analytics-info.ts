export interface AnalyticsWebsiteEntry {
  id: string;
  websiteId: string;
}

export interface AnalyticsInfo {
  apiKey: string;
  umamiWebsiteId: string;
  additionalWebsiteIds: AnalyticsWebsiteEntry[];
}

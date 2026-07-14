export interface UmamiEventDataPivotRow {
  eventId: string;
  websiteId: string;
  createdAt: number;
  propertyKeys: string[];
  propertyValues: (string | null)[];
}

export interface UmamiEventDataPivotResponse {
  data: UmamiEventDataPivotRow[];
  count: number;
  page: number;
  pageSize: number;
}

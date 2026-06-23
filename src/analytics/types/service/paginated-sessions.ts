import type { UmamiSession } from '../umami';

export interface PaginatedSessions {
  page: number;
  limit: number;
  count: number;
  data: UmamiSession[];
}

import type { MetricEntry } from './metric-entry';
import type { SearchQueryType } from './search-query-type';

export type SearchByLabelByType = Record<SearchQueryType, MetricEntry[]>;

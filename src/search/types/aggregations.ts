import { AggregationsAggregationContainer } from '@elastic/elasticsearch/lib/api/types';

export type Aggregations = Record<string, AggregationsAggregationContainer>;

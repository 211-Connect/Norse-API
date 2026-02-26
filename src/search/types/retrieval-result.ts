import { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import { AggregationsStringTermsAggregate } from '@elastic/elasticsearch/lib/api/types';
import { SearchSource } from '../dto/search-response.dto';
import { ShardsInfo } from './shards-info';

export interface RetrievalMetadata {
  took: number;
  timedOut: boolean;
  shards: ShardsInfo;
  aggregations: Record<string, AggregationsStringTermsAggregate> | undefined;
}

export interface RetrievalResult {
  bm25Hits: SearchHit<SearchSource>[];
  knnHits: SearchHit<SearchSource>[];
  metadata: RetrievalMetadata;
}

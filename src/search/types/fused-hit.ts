import { SearchSource } from '../dto/search-response.dto';

export interface FusedHit {
  _id: string;
  _index: string;
  _source: SearchSource;
  rrfScore: number;
  bm25Score?: number;
  knnScore?: number;
}

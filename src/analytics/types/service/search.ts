export interface SearchHits {
  query: string;
  hits: number;
}

export interface Searches {
  text: SearchHits[];
  taxonomy: SearchHits[];
  hybrid: SearchHits[];
}

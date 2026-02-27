export interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

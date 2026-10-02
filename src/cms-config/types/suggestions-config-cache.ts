export type SuggestionCache = {
  id?: string;
  taxonomies: string;
  value: string;
  values: Record<string, string>;
};

export type SuggestionsConfigCache = {
  tenantId: string;
  suggestions: SuggestionCache[];
};

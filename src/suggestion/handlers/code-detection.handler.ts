import { QueryEnhancementHandler } from './query-enhancement-handler.base';
import { SearchContext } from '../types/search-context.interface';

const isTaxonomyCode = new RegExp(
  /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i,
);

export class CodeDetectionHandler extends QueryEnhancementHandler {
  protected shouldProcess(context: SearchContext): boolean {
    // Only run once - check if we haven't set fields yet
    return context.fields.length === 0;
  }

  protected async process(context: SearchContext): Promise<SearchContext> {
    const isCode = isTaxonomyCode.test(context.originalQuery);
    context.isCodeSearch = isCode;
    context.fields = isCode
      ? ['code', 'code._2gram', 'code._3gram']
      : ['name', 'name._2gram', 'name._3gram'];

    // Add initial query
    context.processedQueries.push({
      query: context.originalQuery,
      type: 'user',
      source: 'original',
    });

    return context;
  }
}

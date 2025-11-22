import { SearchContext } from '../types/search-context.interface';

export abstract class QueryEnhancementHandler {
  protected next: QueryEnhancementHandler | null = null;

  setNext(handler: QueryEnhancementHandler): QueryEnhancementHandler {
    this.next = handler;
    return handler;
  }

  async handle(context: SearchContext): Promise<SearchContext> {
    // Process if feature is enabled
    if (this.shouldProcess(context)) {
      context = await this.process(context);
    }

    // Pass to next handler
    if (this.next) {
      return this.next.handle(context);
    }

    return context;
  }

  protected abstract shouldProcess(context: SearchContext): boolean;
  protected abstract process(context: SearchContext): Promise<SearchContext>;
}

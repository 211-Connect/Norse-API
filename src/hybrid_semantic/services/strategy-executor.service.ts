import { Injectable, Logger, Inject } from '@nestjs/common';
import { SearchStrategy, SearchContext } from '../strategies/search-strategy.interface';

/**
 * Service responsible for executing search strategies
 * Orchestrates which strategies to run and builds the msearch body
 */
@Injectable()
export class StrategyExecutorService {
  private readonly logger = new Logger(StrategyExecutorService.name);

  constructor(
    @Inject('SEARCH_STRATEGIES')
    private readonly strategies: SearchStrategy[],
  ) {
    this.logger.log(
      `Initialized with ${strategies.length} search strategies: ${strategies.map((s) => s.name).join(', ')}`,
    );
  }

  /**
   * Build the multi-search body for OpenSearch _msearch
   * Executes all strategies that can run given the current context
   * 
   * @param context - Search context with all necessary information
   * @param indexName - OpenSearch index name
   * @returns Object with msearch body array and strategy names
   */
  buildMsearchBody(
    context: SearchContext,
    indexName: string,
  ): { body: any[]; strategyNames: string[] } {
    const msearchBody: any[] = [];
    const strategyNames: string[] = [];

    for (const strategy of this.strategies) {
      if (strategy.canExecute(context)) {
        this.logger.debug(`Executing strategy: ${strategy.name}`);
        
        // Add index header
        msearchBody.push({ index: indexName });
        
        // Add query body
        const query = strategy.buildQuery(context);
        msearchBody.push(query);
        
        strategyNames.push(strategy.name);
      } else {
        this.logger.debug(`Skipping strategy: ${strategy.name} (canExecute returned false)`);
      }
    }

    this.logger.log(
      `Built msearch body with ${strategyNames.length} strategies: ${strategyNames.join(', ')}`,
    );

    return { body: msearchBody, strategyNames };
  }

  /**
   * Get all registered strategies
   * Useful for debugging and testing
   */
  getStrategies(): SearchStrategy[] {
    return this.strategies;
  }
}

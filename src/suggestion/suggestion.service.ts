import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyTermsQueryDto } from './dto/taxonomy-terms-query.dto';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';

const isTaxonomyCode = new RegExp(
  /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i,
);

@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly nlpUtilsService: NlpUtilsService,
    private readonly aiUtilsService: AiUtilsService,
  ) {}

  async searchTaxonomies(
    options: {
      headers: HeadersDto;
      query: SearchQueryDto;
    },
    version: '1' | '2' | '3' = '1',
  ) {
    try {
      const q = options.query;
      const skip = (q.page - 1) * 10;

      if (!q.query && !q.code) {
        throw { message: 'Query or code is required' };
      }

      const isCode = q.query
        ? isTaxonomyCode.test(q.query)
        : q.code
          ? true
          : false;

      const queryBuilder: any = {
        index: `${options.headers['x-tenant-id']}-taxonomies_v2_${options.headers['accept-language']}`,
        from: skip,
        size: 10,
        query: {
          bool: {
            filter: [],
          },
        },
        aggs: {},
      };

      const searchQuery =
        (!isCode && q.query) || (isCode && q.query)
          ? q.query
          : q.code
            ? q.code
            : '';
      const fields = isCode
        ? ['code', 'code._2gram', 'code._3gram']
        : ['name', 'name._2gram', 'name._3gram'];

      // V2: For name searches, use stemming to improve relevance
      // V1: Use original query without stemming (legacy behavior)
      // For code searches, always use original query (codes don't need stemming)
      if (version === '2' && !isCode && searchQuery) {
        const stemResult =
          this.nlpUtilsService.stemQueryForSuggestion(searchQuery);

        // V2 strategy: Use ONLY the stemmed nouns for search
        // This focuses on the semantically important parts of the query
        // For "I need help with laundry" -> searches only "laundr"
        if (stemResult.shouldUseStemmed) {
          this.logger.debug(
            `[v2] Using stemmed nouns only: "${stemResult.stemmed}" (extracted from: "${searchQuery}")`,
          );

          queryBuilder.query = {
            bool: {
              must: {
                multi_match: {
                  query: stemResult.stemmed,
                  type: 'bool_prefix',
                  fields: fields,
                  fuzziness: 'AUTO',
                },
              },
              filter: [],
            },
          };
        } else {
          // Stemming didn't produce a different result, use original
          // This handles single-word queries like "laundry" or "food"
          this.logger.debug(
            `[v2] Using original query (no nouns extracted or stemming not beneficial): "${searchQuery}"`,
          );
          queryBuilder.query = {
            bool: {
              must: {
                multi_match: {
                  query: searchQuery,
                  type: 'bool_prefix',
                  fields: fields,
                  fuzziness: 'AUTO',
                },
              },
              filter: [],
            },
          };
        }
      } else {
        // V1: Original behavior, but add stemming for better matching
        if (version === '1') {
          // Apply stemming even in V1 for better fuzzy matching
          // This helps "diper" match "Diapers" by stemming both
          if (!isCode && searchQuery) {
            const stemResult =
              this.nlpUtilsService.stemQueryForSuggestion(searchQuery);

            // Use stemmed version if available, otherwise use original
            const queryToUse =
              stemResult.shouldUseStemmed && stemResult.stemmed.length > 0
                ? stemResult.stemmed
                : searchQuery;

            this.logger.debug(
              `[v1] Using ${stemResult.shouldUseStemmed ? 'stemmed' : 'original'} query: "${queryToUse}" (from: "${searchQuery}")`,
            );

            queryBuilder.query = {
              bool: {
                must: {
                  multi_match: {
                    query: queryToUse,
                    type: 'bool_prefix',
                    fields: fields,
                    fuzziness: 'AUTO',
                  },
                },
                filter: [],
              },
            };
          } else {
            // Code search or empty query - use original
            queryBuilder.query = {
              bool: {
                must: {
                  multi_match: {
                    query: searchQuery,
                    type: 'bool_prefix',
                    fields: fields,
                    fuzziness: 'AUTO',
                  },
                },
                filter: [],
              },
            };
          }
        } else {
          // Non-v1, non-v2 fallback (shouldn't happen)
          queryBuilder.query = {
            bool: {
              must: {
                multi_match: {
                  query: searchQuery,
                  type: 'bool_prefix',
                  fields: fields,
                  fuzziness: 'AUTO',
                },
              },
              filter: [],
            },
          };
        }
      }

      // V3: Intent classification with dual-query search
      // Skip intent classification for single-word queries (already specific enough)
      if (
        version === '3' &&
        !isCode &&
        searchQuery &&
        !q.disable_intent_classification
      ) {
        const wordCount = searchQuery.trim().split(/\s+/).length;

        if (wordCount <= 1) {
          this.logger.debug(
            `[v3] Skipping intent classification for single-word query: "${searchQuery}"`,
          );
          // Fall through to standard v2 behavior
        } else {
          try {
            // Classify the user's query to get intent
            const classification =
              await this.aiUtilsService.classifyQuery(searchQuery);

            if (classification.primary_intent) {
              this.logger.debug(
                `[v3] Intent classification: "${classification.primary_intent}" (confidence: ${classification.confidence})`,
              );

              // Preprocess user query for search (same as v2)
              const userStemResult =
                this.nlpUtilsService.stemQueryForSuggestion(searchQuery);

              // Check if user query has meaningful terms after filtering
              const hasUserQuery =
                userStemResult.shouldUseStemmed &&
                userStemResult.stemmed.length > 0;

              if (!hasUserQuery) {
                this.logger.debug(
                  `[v3] User query has no meaningful terms after filtering, using intent queries only`,
                );
              }

              // Extract and preprocess intent name for search
              const intentSearchTerms = this.extractIntentSearchTerms(
                classification.primary_intent,
              );

              this.logger.debug(
                `[v3] Executing multi-query search: user="${hasUserQuery ? userStemResult.stemmed : '(skipped)'}", intent_terms=[${intentSearchTerms.join(', ')}]`,
              );

              // Execute searches: user query (if meaningful) + all intent term searches in parallel
              const searchPromises: Promise<any>[] = [];

              // Only add user query search if it has meaningful terms
              if (hasUserQuery) {
                const userQueryBuilder: any = {
                  index: `${options.headers['x-tenant-id']}-taxonomies_v2_${options.headers['accept-language']}`,
                  from: skip,
                  size: 10,
                  query: {
                    bool: {
                      must: {
                        multi_match: {
                          query: userStemResult.stemmed,
                          type: 'bool_prefix',
                          fields: fields,
                          fuzziness: 'AUTO',
                        },
                      },
                      filter: [],
                    },
                  },
                  aggs: {},
                };
                searchPromises.push(
                  this.elasticsearchService.search(userQueryBuilder),
                );
              }

              // Add intent term searches
              searchPromises.push(
                ...intentSearchTerms.map((term) =>
                  this.executeIntentSearch(term, options.headers, skip, fields),
                ),
              );

              const allResults = await Promise.all(searchPromises);

              // Combine results
              let combinedData: any;
              if (hasUserQuery) {
                const userQueryResults = allResults[0];
                const intentQueryResults = allResults.slice(1);
                combinedData = this.combineMultipleSearchResults(
                  userQueryResults,
                  intentQueryResults,
                );
              } else {
                // No user query, combine all intent query results
                combinedData = this.combineIntentOnlyResults(allResults);
              }

              // Add metadata to response
              return {
                ...combinedData,
                intent_classification: classification,
                search_queries_used: {
                  user_query_stemmed: hasUserQuery
                    ? userStemResult.stemmed
                    : null,
                  intent_queries_stemmed: intentSearchTerms,
                },
              };
            } else {
              this.logger.debug(
                `[v3] No primary intent found, falling back to v2 behavior`,
              );
            }
          } catch (error) {
            this.logger.warn(
              `[v3] Intent classification failed: ${error.message}, falling back to v2 behavior`,
            );
          }
        } // Close else block for multi-word queries
      }

      const data = await this.elasticsearchService.search(queryBuilder);

      return data;
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * Extract and preprocess intent name into individual search terms
   * Applies same NLP preprocessing as user queries (POS tagging + stemming)
   * Returns array of individual stemmed nouns for separate searches
   */
  private extractIntentSearchTerms(intentName: string): string[] {
    // Apply NLP preprocessing to intent name
    const stemResult = this.nlpUtilsService.stemQueryForSuggestion(intentName);

    if (stemResult.shouldUseStemmed && stemResult.stemmed) {
      // Split stemmed result into individual terms
      const terms = stemResult.stemmed.split(/\s+/).filter((t) => t.length > 0);

      this.logger.debug(
        `[v3] Intent preprocessing: "${intentName}" -> [${terms.join(', ')}]`,
      );

      return terms;
    }

    // If no stemming benefit, return lowercase version as single term
    return [intentName.toLowerCase()];
  }

  /**
   * Execute search using intent-derived query
   */
  private async executeIntentSearch(
    intentQuery: string,
    headers: HeadersDto,
    skip: number,
    fields: string[],
  ): Promise<any> {
    const queryBuilder: any = {
      index: `${headers['x-tenant-id']}-taxonomies_v2_${headers['accept-language']}`,
      from: skip,
      size: 10,
      query: {
        bool: {
          must: {
            multi_match: {
              query: intentQuery,
              type: 'bool_prefix',
              fields: fields,
              fuzziness: 'AUTO',
            },
          },
          filter: [],
        },
      },
      aggs: {},
    };

    return this.elasticsearchService.search(queryBuilder);
  }

  /**
   * Combine and deduplicate results from multiple queries
   * Takes higher score when document appears in multiple result sets
   */
  private combineMultipleSearchResults(
    userQueryResults: any,
    intentQueryResults: any[],
  ): any {
    const hitMap = new Map<string, any>();

    // Add all hits from user query result set
    for (const hit of userQueryResults.hits?.hits || []) {
      hitMap.set(hit._id, hit);
    }

    // Add hits from all intent query result sets, keeping higher score if duplicate
    for (const intentResults of intentQueryResults) {
      for (const hit of intentResults.hits?.hits || []) {
        const existing = hitMap.get(hit._id);
        if (!existing || hit._score > existing._score) {
          hitMap.set(hit._id, hit);
        }
      }
    }

    // Convert map back to array and sort by score
    const combinedHits = Array.from(hitMap.values()).sort(
      (a, b) => b._score - a._score,
    );

    // Calculate total took time from all queries
    const totalTook =
      userQueryResults.took +
      intentQueryResults.reduce((sum, r) => sum + r.took, 0);

    // Return combined result in Elasticsearch response format
    return {
      took: totalTook,
      timed_out:
        userQueryResults.timed_out ||
        intentQueryResults.some((r) => r.timed_out),
      _shards: userQueryResults._shards,
      hits: {
        total: {
          value: combinedHits.length,
          relation: 'eq',
        },
        max_score: combinedHits[0]?._score || null,
        hits: combinedHits,
      },
    };
  }

  /**
   * Combine results from intent queries only (when user query is skipped)
   * Used when all user query nouns are generic and filtered out
   */
  private combineIntentOnlyResults(intentQueryResults: any[]): any {
    if (intentQueryResults.length === 0) {
      // Return empty result set
      return {
        took: 0,
        timed_out: false,
        _shards: { total: 0, successful: 0, skipped: 0, failed: 0 },
        hits: {
          total: { value: 0, relation: 'eq' },
          max_score: null,
          hits: [],
        },
      };
    }

    const hitMap = new Map<string, any>();

    // Add hits from all intent query result sets, keeping higher score if duplicate
    for (const intentResults of intentQueryResults) {
      for (const hit of intentResults.hits?.hits || []) {
        const existing = hitMap.get(hit._id);
        if (!existing || hit._score > existing._score) {
          hitMap.set(hit._id, hit);
        }
      }
    }

    // Convert map back to array and sort by score
    const combinedHits = Array.from(hitMap.values()).sort(
      (a, b) => b._score - a._score,
    );

    // Calculate total took time from all queries
    const totalTook = intentQueryResults.reduce((sum, r) => sum + r.took, 0);

    // Return combined result in Elasticsearch response format
    return {
      took: totalTook,
      timed_out: intentQueryResults.some((r) => r.timed_out),
      _shards: intentQueryResults[0]._shards,
      hits: {
        total: {
          value: combinedHits.length,
          relation: 'eq',
        },
        max_score: combinedHits[0]?._score || null,
        hits: combinedHits,
      },
    };
  }

  async getTaxonomyTermsForCodes(options: {
    headers: HeadersDto;
    query: TaxonomyTermsQueryDto;
  }) {
    const q = options.query;

    const queryBuilder: any = {
      index: `${options.headers['x-tenant-id']}-taxonomies_v2_${options.headers['accept-language']}`,
      query: {
        terms: {
          'code.raw': q?.terms ?? [],
        },
      },
    };

    let data;
    try {
      data = await this.elasticsearchService.search(queryBuilder);
    } catch (err) {
      console.log(err);
      data = {};
    }

    return data;
  }
}

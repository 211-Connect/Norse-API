import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyTermsQueryDto } from './dto/taxonomy-terms-query.dto';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

const isTaxonomyCode = new RegExp(
  /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i,
);

@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly nlpUtilsService: NlpUtilsService,
  ) {}

  async searchTaxonomies(
    options: {
      headers: HeadersDto;
      query: SearchQueryDto;
    },
    version: '1' | '2' = '1',
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
                },
              },
              filter: [],
            },
          };
        }
      } else {
        // V1: Original behavior
        if (version === '1') {
          this.logger.debug(
            `[v1] Using original query without stemming: "${searchQuery}"`,
          );
        }
        queryBuilder.query = {
          bool: {
            must: {
              multi_match: {
                query: searchQuery,
                type: 'bool_prefix',
                fields: fields,
              },
            },
            filter: [],
          },
        };
      }

      const data = await this.elasticsearchService.search(queryBuilder);

      return data;
    } catch (err) {
      throw new BadRequestException(err.message);
    }
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

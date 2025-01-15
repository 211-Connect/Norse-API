import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyTermsQueryDto } from './dto/taxonomy-terms-query.dto';

const isTaxonomyCode = new RegExp(
  /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i,
);

@Injectable()
export class TaxonomyService {
  private readonly logger: Logger;

  constructor(private readonly elasticsearchService: ElasticsearchService) {
    this.logger = new Logger(TaxonomyService.name);
  }

  async searchTaxonomies(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
  }) {
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
          should: [
            { term: { type: 'taxonomy' } },
            { bool: { must_not: { exists: { field: 'type' } } } },
          ],
          minimum_should_match: 1,
        },
      };

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

    this.logger.debug(
      `Fetching taxonomy term for codes. queryBuilder: ${JSON.stringify(queryBuilder, null, 2)}`,
    );

    let data;
    try {
      data = await this.elasticsearchService.search(queryBuilder);
    } catch (err) {
      this.logger.error(err);

      data = {};
    }

    return data;
  }
}

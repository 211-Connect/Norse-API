import { type SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { Router } from 'express';
import z from 'zod';
import { ElasticClient } from '../lib/ElasticClient';
import { cacheControl } from '../lib/cacheControl';
import { logger } from '../lib/winston';

const router = Router();

const isTaxonomyCode = new RegExp(
  /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i,
);

const QuerySchema = z.object({
  query: z.string().optional(),
  code: z.string().optional(),
  page: z.number().default(1),
  locale: z.string().default('en'),
  tenant_id: z.string().default(''),
});

router.get('/', async (req, res) => {
  try {
    const q = await QuerySchema.parseAsync(req.query);
    const skip = (q.page - 1) * 10;

    if (!q.query && !q.code) {
      throw new Error('Query or code is required');
    }

    const isCode = q.query
      ? isTaxonomyCode.test(q.query)
      : q.code
        ? true
        : false;

    const queryBuilder: SearchRequest = {
      index: `${q.tenant_id}-taxonomies_v2_${q.locale}`,
      from: skip,
      size: 10,
      query: {
        bool: {
          filter: [],
        },
      },
      aggs: {},
    };

    const query =
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
            query: query,
            type: 'bool_prefix',
            fields: fields,
          },
        },
        filter: [],
      },
    };

    const data = await ElasticClient.search(queryBuilder);

    cacheControl(res);
    res.json(data);
  } catch (err) {
    logger.error('Taxonomy search error', err);
    res.sendStatus(400);
  }
});

router.get('/taxonomy-term', async (req, res) => {
  const QuerySchema = z.object({
    tenant_id: z.string().default(''),
    locale: z.string().default('en'),
    terms: z.array(z.string()).default([]),
  });

  let q;
  try {
    q = await QuerySchema.parseAsync(req.query);
  } catch (err) {
    logger.error(err);
    q = {};
  }

  const queryBuilder: SearchRequest = {
    index: `${q.tenant_id}-taxonomies_v2_${q.locale}`,
    query: {
      terms: {
        'code.raw': q?.terms ?? [],
      },
    },
  };

  let data;
  try {
    data = await ElasticClient.search(queryBuilder);
  } catch (err) {
    logger.error(err);
    data = {};
  }

  res.json(data);
});

export default router;

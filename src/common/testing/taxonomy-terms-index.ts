import { errors } from '@elastic/elasticsearch';

/** One `taxonomy_terms` document, as Dagster publishes it (ISS-1947). */
export interface TaxonomyTermDoc {
  resourceWriterId: string;
  taxonomy: string;
  code: string;
  isAncestor: boolean;
  names: Record<string, string>;
}

export const taxonomyTerm = (
  resourceWriterId: string,
  code: string,
  names: Record<string, string>,
  extra: Partial<TaxonomyTermDoc> = {},
): TaxonomyTermDoc => ({
  resourceWriterId,
  taxonomy: 'HSIS',
  code,
  isAncestor: false,
  names,
  ...extra,
});

type SearchRequestLike = Record<string, any>;

/**
 * A fixture `taxonomy_terms` index for a mocked `search`: answers requests to
 * that index by evaluating their `terms` filters, `sort`, `search_after` and
 * `size` over `docs`, and hands any other request to `otherwise`.
 */
export function taxonomyTermsIndex(
  docs: TaxonomyTermDoc[],
  otherwise: (request: SearchRequestLike) => unknown = () => {
    throw new Error('unexpected search outside taxonomy_terms');
  },
) {
  return async (request: SearchRequestLike) => {
    if (request.index !== 'taxonomy_terms') return otherwise(request);
    const filters: Record<string, string[]>[] = (
      request.query?.bool?.filter ?? []
    ).map((clause: { terms: Record<string, string[]> }) => clause.terms);
    const sortFields: string[] = (request.sort ?? []).map(
      (s: string | Record<string, unknown>) =>
        typeof s === 'string' ? s : Object.keys(s)[0],
    );
    const keyOf = (doc: TaxonomyTermDoc) =>
      sortFields.map((f) => String(doc[f as keyof TaxonomyTermDoc]));
    const compare = (a: string[], b: string[]) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return 0;
    };

    let matching = docs.filter((doc) =>
      filters.every((terms) =>
        Object.entries(terms).every(([field, values]) =>
          values.includes(String(doc[field as keyof TaxonomyTermDoc])),
        ),
      ),
    );
    if (sortFields.length > 0) {
      matching = [...matching].sort((a, b) => compare(keyOf(a), keyOf(b)));
    }
    if (request.search_after) {
      const after = request.search_after.map(String);
      matching = matching.filter((doc) => compare(keyOf(doc), after) > 0);
    }
    const page = matching.slice(0, request.size ?? 10);
    return {
      hits: {
        hits: page.map((doc) => ({
          _source: doc,
          ...(sortFields.length > 0 ? { sort: keyOf(doc) } : {}),
        })),
      },
    };
  };
}

/** What the cluster answers before Dagster's first reader run creates the index. */
export const taxonomyTermsIndexNotFound = () =>
  new errors.ResponseError({
    statusCode: 404,
    body: {
      error: {
        root_cause: [
          {
            type: 'index_not_found_exception',
            reason: 'no such index [taxonomy_terms]',
            index: 'taxonomy_terms',
          },
        ],
        type: 'index_not_found_exception',
        reason: 'no such index [taxonomy_terms]',
        index: 'taxonomy_terms',
      },
      status: 404,
    },
    headers: {},
    warnings: null,
    meta: {} as never,
  });

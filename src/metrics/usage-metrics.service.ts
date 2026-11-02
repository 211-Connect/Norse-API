import { Injectable, NotFoundException } from '@nestjs/common';
import { Counter, register } from '@prometheus-io/client';
import { acceptLanguageSchema } from '../common/dto/headers.dto';
import { TenantConfigService } from '../cms-config/tenant-config.service';

/**
 * Search engines a search request can exercise. Mirrors the actual code paths:
 * `SearchService.getQueryType()` maps `query_type` `text` to `keyword` or
 * `match_all`, `taxonomy`/`more_like_this` map to themselves, `hybrid` is
 * delegated to `HybridSearchService.searchHybrid()`, and the organization
 * typeahead endpoint is a separate search path (`OrganizationService.search()`,
 * ES operation `organization_search`).
 */
export const SEARCH_TYPES = [
  'keyword',
  'match_all',
  'taxonomy',
  'more_like_this',
  'hybrid',
  'organization',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchOutcome = 'results' | 'zero_results' | 'error';
export type ResourceOutcome = 'found' | 'not_found' | 'error';

const DEFAULT_LOCALE = 'en';
const OTHER_LOCALE = 'other';
const UNKNOWN_TENANT = 'unknown';

/**
 * Locales the platform ships, reduced to their lowercase primary subtag so a
 * `locale` label can never be an arbitrary client-supplied string. Source of
 * truth: the Norse CMS locale list (`src/payload/i18n/locales.ts`); `zh-Hans`
 * and `zh-Hant` collapse to `zh` because the label keeps only the primary
 * subtag. Keep this list in sync when the platform adds or drops a language.
 */
export const PLATFORM_LOCALES: readonly string[] = [
  'am',
  'ar',
  'de',
  'en',
  'es',
  'fa',
  'ff',
  'fi',
  'fil',
  'fj',
  'fr',
  'gu',
  'haw',
  'hi',
  'hr',
  'ht',
  'ja',
  'km',
  'ko',
  'lo',
  'mww',
  'ne',
  'om',
  'or',
  'pl',
  'prs',
  'ps',
  'pt',
  'ru',
  'rw',
  'sm',
  'so',
  'sw',
  'tl',
  'uk',
  'vi',
  'yue',
  'zh',
];

const PLATFORM_LOCALE_SET = new Set(PLATFORM_LOCALES);

/**
 * Lowercase primary subtag of the highest-priority `accept-language` entry
 * (`es-MX,es;q=0.9` → `es`, `zh-Hant-TW` → `zh`), or `null` when the header is
 * missing, blank, or yields no usable subtag. Uses the same parser the
 * services use, so the metric matches the locale sent to Elasticsearch.
 */
export function primarySubtag(
  acceptLanguage: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(acceptLanguage)
    ? acceptLanguage[0]
    : acceptLanguage;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const trimmed = raw.trim();
  let resolved: string;
  try {
    resolved = acceptLanguageSchema.parse(trimmed);
  } catch {
    resolved = trimmed.split(',')[0];
  }

  const primary = resolved.split(';')[0].split('-')[0].trim().toLowerCase();
  return primary.length > 0 ? primary : null;
}

/**
 * Bounded `locale` label: the request's primary subtag when the tenant's
 * cached locales or the platform locale list allow it, else `other`. A missing
 * header means `en`, the same default the services use. `tenantLocales` must be
 * the in-process cached value — this function never performs I/O.
 */
export function resolveLocale(
  acceptLanguage: string | string[] | undefined,
  tenantLocales?: readonly string[],
): string {
  const primary = primarySubtag(acceptLanguage);
  if (primary === null) {
    return DEFAULT_LOCALE;
  }
  if (tenantLocales?.some((locale) => primarySubtag(locale) === primary)) {
    return primary;
  }
  return PLATFORM_LOCALE_SET.has(primary) ? primary : OTHER_LOCALE;
}

/**
 * `search_type` for a `/search` request, derived the same way
 * `SearchService.getQueryType()` derives the Elasticsearch operation.
 */
export function searchTypeFor(
  queryType: string | undefined,
  query: unknown,
): SearchType {
  switch (queryType) {
    case 'taxonomy':
      return 'taxonomy';
    case 'more_like_this':
      return 'more_like_this';
    case 'hybrid':
      return 'hybrid';
    default:
      return isEmptyQuery(query) ? 'match_all' : 'keyword';
  }
}

function isEmptyQuery(query: unknown): boolean {
  if (typeof query === 'string') {
    return query.length === 0;
  }
  if (Array.isArray(query)) {
    return query.length === 0;
  }
  return false;
}

/** `results` when at least one hit survived, `zero_results` otherwise. */
export function searchOutcomeFromHits(
  hits: { total?: number | { value: number } } | undefined,
): SearchOutcome {
  const total = hits?.total;
  const count = typeof total === 'number' ? total : (total?.value ?? 0);
  return count > 0 ? 'results' : 'zero_results';
}

/** `results` when the endpoint reported at least one hit. */
export function searchOutcomeFromTotal(
  total: number | undefined,
): SearchOutcome {
  return typeof total === 'number' && total > 0 ? 'results' : 'zero_results';
}

/** `not_found` only for a resource lookup that resolved to no document. */
export function resourceOutcomeFromError(error: unknown): ResourceOutcome {
  return error instanceof NotFoundException ? 'not_found' : 'error';
}

export type UsageRequestContext = {
  /** `request.tenantId` from TenantMiddleware; anything else is `unknown`. */
  tenantId?: string;
  /** Raw `accept-language` request header, when present. */
  acceptLanguage?: string | string[];
};

@Injectable()
export class UsageMetricsService {
  private readonly searchRequestsCounter: Counter<string>;
  private readonly resourceRequestsCounter: Counter<string>;

  constructor(private readonly tenantConfigService: TenantConfigService) {
    this.searchRequestsCounter = this.createOrGetCounter({
      name: 'norse_search_requests_total',
      help: 'Search requests by tenant, language, search type and outcome',
      labelNames: ['tenant_id', 'locale', 'search_type', 'outcome'],
      registers: [register],
    });

    this.resourceRequestsCounter = this.createOrGetCounter({
      name: 'norse_resource_requests_total',
      help: 'Resource requests by tenant, language and outcome',
      labelNames: ['tenant_id', 'locale', 'outcome'],
      registers: [register],
    });
  }

  /**
   * Records one search HTTP request. Call exactly once per request, at the
   * controller/service boundary — never per Elasticsearch call.
   */
  recordSearchRequest(
    context: UsageRequestContext,
    searchType: SearchType,
    outcome: SearchOutcome,
  ): void {
    this.searchRequestsCounter.inc({
      ...this.labels(context),
      search_type: searchType,
      outcome,
    });
  }

  /** Records one resource HTTP request (single-resource lookup). */
  recordResourceRequest(
    context: UsageRequestContext,
    outcome: ResourceOutcome,
  ): void {
    this.resourceRequestsCounter.inc({
      ...this.labels(context),
      outcome,
    });
  }

  private labels(context: UsageRequestContext): {
    tenant_id: string;
    locale: string;
  } {
    const tenantId =
      typeof context.tenantId === 'string' && context.tenantId.length > 0
        ? context.tenantId
        : UNKNOWN_TENANT;

    // Cached locale values only: this runs on the request hot path and must
    // not add Redis or CMS calls.
    const tenantLocales =
      tenantId === UNKNOWN_TENANT
        ? undefined
        : this.tenantConfigService.getCachedTenantLocales(tenantId);

    return {
      tenant_id: tenantId,
      locale: resolveLocale(context.acceptLanguage, tenantLocales),
    };
  }

  private createOrGetCounter(
    config: ConstructorParameters<typeof Counter>[0],
  ): Counter {
    const existingMetric = register.getSingleMetric(config.name);
    if (existingMetric instanceof Counter) {
      return existingMetric;
    }
    return new Counter(config);
  }
}

import { NotFoundException } from '@nestjs/common';
import { Counter, register } from '@prometheus-io/client';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import {
  PLATFORM_LOCALES,
  UsageMetricsService,
  primarySubtag,
  resolveLocale,
  resourceOutcomeFromError,
  searchOutcomeFromHits,
  searchOutcomeFromTotal,
  searchTypeFor,
} from './usage-metrics.service';

const getMetric = (name: string): Counter<string> => {
  const metric = register.getSingleMetric(name);
  expect(metric).toBeDefined();
  return metric as Counter<string>;
};

describe('UsageMetricsService', () => {
  let service: UsageMetricsService;
  let tenantConfig: { getCachedTenantLocales: jest.Mock };

  beforeEach(() => {
    register.clear();
    tenantConfig = { getCachedTenantLocales: jest.fn() };
    service = new UsageMetricsService(
      tenantConfig as unknown as TenantConfigService,
    );
  });

  describe('primarySubtag', () => {
    it.each([
      ['es-MX,es;q=0.9', 'es'],
      ['ES', 'es'],
      ['zh-Hant-TW', 'zh'],
      ['fr-CA,de;q=0.9', 'fr'],
      ['en-US', 'en'],
    ])('normalises %p to %p', (header, expected) => {
      expect(primarySubtag(header)).toBe(expected);
    });

    it.each([[''], ['   '], [undefined]])(
      'returns null for a missing or blank header (%p)',
      (header) => {
        expect(primarySubtag(header as string | undefined)).toBeNull();
      },
    );

    it('keeps the highest-quality entry of a list', () => {
      expect(primarySubtag('de;q=0.4,ja;q=0.9')).toBe('ja');
    });

    it('returns the raw token for garbage so the allowlist can reject it', () => {
      expect(primarySubtag('not a language!')).toBe('not a language!');
    });
  });

  describe('resolveLocale', () => {
    it('falls back to en when the header is missing or empty', () => {
      expect(resolveLocale(undefined)).toBe('en');
      expect(resolveLocale('')).toBe('en');
    });

    it('allows a locale from the tenant cached locale list', () => {
      expect(resolveLocale('sv-SE', ['en', 'sv-SE'])).toBe('sv');
    });

    it('allows a locale from the platform list', () => {
      expect(resolveLocale('haw')).toBe('haw');
    });

    it('maps a well-formed locale outside both lists to other', () => {
      expect(resolveLocale('xx-YY')).toBe('other');
    });

    it('maps garbage and wildcards to other', () => {
      expect(resolveLocale('garbage')).toBe('other');
      expect(resolveLocale('*')).toBe('other');
    });

    it('bounds the platform list to known locales', () => {
      expect(PLATFORM_LOCALES).toContain('en');
      expect(PLATFORM_LOCALES).toContain('es');
      expect(PLATFORM_LOCALES).not.toContain('zh-Hant');
    });
  });

  describe('searchTypeFor', () => {
    it('maps text queries to keyword and empty text to match_all', () => {
      expect(searchTypeFor('text', 'housing')).toBe('keyword');
      expect(searchTypeFor('text', '')).toBe('match_all');
      expect(searchTypeFor('text', [])).toBe('match_all');
    });

    it('maps the explicit query types and the default', () => {
      expect(searchTypeFor('taxonomy', 'BM-1400')).toBe('taxonomy');
      expect(searchTypeFor('more_like_this', 'x')).toBe('more_like_this');
      expect(searchTypeFor('hybrid', 'x')).toBe('hybrid');
      expect(searchTypeFor(undefined, 'x')).toBe('keyword');
    });

    it('only produces values from the fixed enum', () => {
      const values = new Set([
        searchTypeFor('text', ''),
        searchTypeFor('text', 'x'),
        searchTypeFor('taxonomy', 'x'),
        searchTypeFor('more_like_this', 'x'),
        searchTypeFor('hybrid', 'x'),
      ]);
      expect([...values].sort()).toEqual([
        'hybrid',
        'keyword',
        'match_all',
        'more_like_this',
        'taxonomy',
      ]);
    });
  });

  describe('outcome mapping', () => {
    it('derives the search outcome from hits.total in both shapes', () => {
      expect(searchOutcomeFromHits({ total: 0 })).toBe('zero_results');
      expect(searchOutcomeFromHits({ total: { value: 0 } })).toBe(
        'zero_results',
      );
      expect(searchOutcomeFromHits({ total: 3 })).toBe('results');
      expect(searchOutcomeFromHits({ total: { value: 3 } })).toBe('results');
      expect(searchOutcomeFromHits(undefined)).toBe('zero_results');
    });

    it('derives the search outcome from a plain total', () => {
      expect(searchOutcomeFromTotal(0)).toBe('zero_results');
      expect(searchOutcomeFromTotal(5)).toBe('results');
      expect(searchOutcomeFromTotal(undefined)).toBe('zero_results');
    });

    it('maps only a NotFoundException to not_found', () => {
      expect(resourceOutcomeFromError(new NotFoundException())).toBe(
        'not_found',
      );
      expect(resourceOutcomeFromError(new Error('boom'))).toBe('error');
      expect(resourceOutcomeFromError('boom')).toBe('error');
    });
  });

  describe('recording', () => {
    it('records one search series with the validated tenant and allowlisted locale', async () => {
      tenantConfig.getCachedTenantLocales.mockReturnValue(['en', 'es']);

      service.recordSearchRequest(
        { tenantId: 'tenant-1', acceptLanguage: 'es-MX,es;q=0.9' },
        'keyword',
        'results',
      );

      const values = (await getMetric('norse_search_requests_total').get())
        .values;
      expect(values).toHaveLength(1);
      expect(values[0].value).toBe(1);
      expect(values[0].labels).toEqual({
        tenant_id: 'tenant-1',
        locale: 'es',
        search_type: 'keyword',
        outcome: 'results',
      });
    });

    it('uses unknown for a missing tenant and never touches the tenant cache', async () => {
      service.recordSearchRequest({}, 'match_all', 'zero_results');

      const values = (await getMetric('norse_search_requests_total').get())
        .values;
      expect(values[0].labels).toEqual({
        tenant_id: 'unknown',
        locale: 'en',
        search_type: 'match_all',
        outcome: 'zero_results',
      });
      expect(tenantConfig.getCachedTenantLocales).not.toHaveBeenCalled();
    });

    it('accepts tenant locales outside the platform list from the cache', async () => {
      tenantConfig.getCachedTenantLocales.mockReturnValue(['xx-YY']);

      service.recordResourceRequest(
        { tenantId: 'tenant-1', acceptLanguage: 'xx-YY' },
        'found',
      );

      const values = (await getMetric('norse_resource_requests_total').get())
        .values;
      expect(values[0].labels).toEqual({
        tenant_id: 'tenant-1',
        locale: 'xx',
        outcome: 'found',
      });
    });

    it('records the resource counter with only bounded labels', async () => {
      service.recordResourceRequest(
        { tenantId: 'tenant-1', acceptLanguage: 'zh-Hant-TW' },
        'not_found',
      );

      const metric = getMetric('norse_resource_requests_total');
      const values = (await metric.get()).values;
      expect(Object.keys(values[0].labels).sort()).toEqual([
        'locale',
        'outcome',
        'tenant_id',
      ]);
      expect(values[0].labels).toEqual({
        tenant_id: 'tenant-1',
        locale: 'zh',
        outcome: 'not_found',
      });
    });

    it('increments an existing series instead of duplicating it', async () => {
      const context = { tenantId: 'tenant-1', acceptLanguage: 'en' };
      service.recordSearchRequest(context, 'keyword', 'error');
      service.recordSearchRequest(context, 'keyword', 'error');

      const values = (await getMetric('norse_search_requests_total').get())
        .values;
      expect(values).toHaveLength(1);
      expect(values[0].value).toBe(2);
    });
  });
});

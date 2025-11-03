import {
  getTenantShortCode,
  getAvailableTenants,
  hasTenantMapping,
  TENANT_MAPPINGS,
} from './tenant-mapping.config';

describe('TenantMappingConfig', () => {
  describe('getTenantShortCode', () => {
    it('should return the correct short code for Illinois 211', () => {
      const shortCode = getTenantShortCode('Illinois 211');
      expect(shortCode).toBe('il211');
    });

    it('should return the original tenant name if no mapping exists (non-strict mode)', () => {
      const shortCode = getTenantShortCode('Unknown Tenant');
      expect(shortCode).toBe('Unknown Tenant');
    });

    it('should throw an error if no mapping exists in strict mode', () => {
      expect(() => {
        getTenantShortCode('Unknown Tenant', true);
      }).toThrow('Tenant mapping not found for: "Unknown Tenant"');
    });

    it('should handle empty string gracefully', () => {
      const shortCode = getTenantShortCode('');
      expect(shortCode).toBe('');
    });
  });

  describe('hasTenantMapping', () => {
    it('should return true for Illinois 211', () => {
      expect(hasTenantMapping('Illinois 211')).toBe(true);
    });

    it('should return false for unknown tenant', () => {
      expect(hasTenantMapping('Unknown Tenant')).toBe(false);
    });
  });

  describe('getAvailableTenants', () => {
    it('should return an array of tenant names', () => {
      const tenants = getAvailableTenants();
      expect(Array.isArray(tenants)).toBe(true);
      expect(tenants.length).toBeGreaterThan(0);
    });

    it('should include Illinois 211 in the list', () => {
      const tenants = getAvailableTenants();
      expect(tenants).toContain('Illinois 211');
    });
  });

  describe('TENANT_MAPPINGS', () => {
    it('should have valid structure for all mappings', () => {
      Object.entries(TENANT_MAPPINGS).forEach(([key, mapping]) => {
        expect(mapping).toHaveProperty('name');
        expect(mapping).toHaveProperty('shortCode');
        expect(mapping.name).toBe(key);
        expect(typeof mapping.shortCode).toBe('string');
        expect(mapping.shortCode.length).toBeGreaterThan(0);
      });
    });

    it('should have unique short codes', () => {
      const shortCodes = Object.values(TENANT_MAPPINGS).map((m) => m.shortCode);
      const uniqueShortCodes = new Set(shortCodes);
      expect(shortCodes.length).toBe(uniqueShortCodes.size);
    });
  });
});

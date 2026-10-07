import { OrganizationSchema } from './organization.schema';

describe('OrganizationSchema', () => {
  it('declares the tenant + service@location compound index (ISS-2096)', () => {
    const indexes = OrganizationSchema.indexes();

    expect(indexes).toContainEqual([
      { tenant_id: 1, 'services.SERVICE_AT_LOCATIONS.ID': 1 },
      expect.any(Object),
    ]);
  });
});

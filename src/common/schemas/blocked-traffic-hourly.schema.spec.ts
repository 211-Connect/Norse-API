import {
  BLOCKED_TRAFFIC_RETENTION_SECONDS,
  BlockedTrafficHourlySchema,
} from './blocked-traffic-hourly.schema';

describe('BlockedTrafficHourlySchema', () => {
  const indexes = BlockedTrafficHourlySchema.indexes();

  it('keeps buckets for 2 years with a TTL index on hour', () => {
    expect(BLOCKED_TRAFFIC_RETENTION_SECONDS).toBe(2 * 365 * 24 * 60 * 60);
    expect(indexes).toContainEqual([
      { hour: 1 },
      expect.objectContaining({
        expireAfterSeconds: BLOCKED_TRAFFIC_RETENTION_SECONDS,
      }),
    ]);
  });

  it('upserts on a unique tenant / hour / classification / enforced key', () => {
    expect(indexes).toContainEqual([
      { tenantId: 1, hour: 1, classification: 1, enforced: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});

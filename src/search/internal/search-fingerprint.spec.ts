import { shardPreference } from 'src/common/elasticsearch/shard-preference';
import { SearchIdentity, searchFingerprint } from './search-fingerprint';

describe('resource search shard preference', () => {
  const search: SearchIdentity = {
    tenantId: '34bf4d99-fd27-4818-a644-9b3964c00d9f',
    lang: 'en',
    queryStr: 'food',
    filters: { state: 'MD' },
    taxonomies: ['BD-1800', 'BD-1800.2000'],
    coords: [-76.6, 39.3],
    distance: 10,
    age: 30,
    geoType: 'boundary',
    organizationId: undefined,
    geometry: undefined,
  };

  it('keeps the hybrid preference it had before the text path shared it', () => {
    // A changed preference moves every in-flight hybrid search to the other
    // shard copy once — a visible reorder for API consumers — and the same
    // fingerprint keys the relevance-cutoff cache. Change it on purpose only.
    expect(shardPreference('hybrid', searchFingerprint(search))).toBe(
      'hybrid-bbee2ef9aeff16a01cc03b04',
    );
  });

  it('separates search paths that share an identity', () => {
    expect(shardPreference('keyword', searchFingerprint(search))).not.toBe(
      shardPreference('hybrid', searchFingerprint(search)),
    );
  });
});

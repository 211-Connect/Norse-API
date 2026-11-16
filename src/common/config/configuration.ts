import { releaseInfo } from '../release/release-info';

export default () => ({
  port: parseInt(process.env.PORT, 10) || 8080,
  logLevel: process.env.LOG_LEVEL || 'warn',
  // Set at image build time (Dockerfile ARGs); read through releaseInfo(),
  // which reports `unknown` when unset. See src/common/release/release-info.ts.
  release: releaseInfo(),
  MAPBOX_API_KEY: process.env.MAPBOX_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  REDIS_URL: process.env.REDIS_URL,
  CMS_REDIS_URL: process.env.CMS_REDIS_URL,
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL_SECONDS, 10) || 60, // 60 seconds
    limit: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60, // 60 request per minute
  },
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  ARCJET_KEY: process.env.ARCJET_KEY,
  METRICS_ENDPOINT_ENABLED: ['true', '1', 'yes', 'on'].includes(
    (process.env.PROMETHEUS_METRICS_ENDPOINT_ENABLED ?? '')
      .trim()
      .toLowerCase(),
  ),
  METRICS_TOKEN: process.env.PROMETHEUS_METRICS_TOKEN || '',
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  // Need boost on hybrid search (ISS-2745); on only for the exact string `true`.
  NEED_BOOST_ENABLED: process.env.NEED_BOOST_ENABLED,
  // /v2/search (ISS-2499); on only for the exact string `true`.
  V2_SEARCH_ENABLED: process.env.V2_SEARCH_ENABLED,
  // Timeout of the /v2/search classify call, in ms (integer; default 1000).
  V2_CLASSIFY_TIMEOUT_MS: process.env.V2_CLASSIFY_TIMEOUT_MS,
  // ml-broker accepts `emergency_only` on search-classification (ml-broker
  // PR #20); on only for the exact string `true`.
  ML_BROKER_EMERGENCY_ONLY_SUPPORTED:
    process.env.ML_BROKER_EMERGENCY_ONLY_SUPPORTED,
  ML_BROKER_BASE_URL: process.env.ML_BROKER_BASE_URL,
  ML_BROKER_API_KEY: process.env.ML_BROKER_API_KEY,
  OPENCAGE_API_KEY: process.env.OPENCAGE_API_KEY,
  umami: {
    apiUrl: process.env.UMAMI_API_URL || '',
    apiKey: process.env.UMAMI_API_KEY || '',
  },
  analytics: {
    cache: {
      responseLruMax:
        parseInt(process.env.ANALYTICS_RESPONSE_LRU_MAX, 10) || 500,
      configLruMax: parseInt(process.env.ANALYTICS_CONFIG_LRU_MAX, 10) || 1000,
      sessionTtlMs:
        parseInt(process.env.ANALYTICS_SESSION_CACHE_TTL_MS, 10) || 60_000,
      l1Enabled: process.env.ANALYTICS_L1_CACHE_ENABLED !== 'false',
    },
  },
  permissionsSideChannelUrl:
    process.env.PERMISSIONS_SIDECHANNEL_BASE_URL || 'http://unkey-auth:8081',
});

export function validateConfiguration(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const apiKey = environment.UMAMI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('UMAMI_API_KEY is required');
  }
  return environment;
}

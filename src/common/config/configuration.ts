export default () => ({
  port: parseInt(process.env.PORT, 10) || 8080,
  logLevel: process.env.LOG_LEVEL || 'warn',
  MAPBOX_API_KEY: process.env.MAPBOX_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  REDIS_URL: process.env.REDIS_URL,
  CMS_REDIS_URL: process.env.CMS_REDIS_URL,
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL_SECONDS, 10) || 60, // 60 seconds
    limit: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60, // 60 request per minute
  },
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  PUSH_GATEWAY_URL: process.env.PROMETHEUS_PUSHGATEWAY_URL || '',
  PUSH_GATEWAY_USERNAME: process.env.PROMETHEUS_PUSHGATEWAY_USERNAME || '',
  PUSH_GATEWAY_PASSWORD: process.env.PROMETHEUS_PUSHGATEWAY_PASSWORD || '',
  PUSH_INTERVAL_MS:
    parseInt(process.env.PROMETHEUS_PUSH_INTERVAL_MS, 10) || 15_000,
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  ML_BROKER_BASE_URL: process.env.ML_BROKER_BASE_URL,
  ML_BROKER_API_KEY: process.env.ML_BROKER_API_KEY,
  OPENCAGE_API_KEY: process.env.OPENCAGE_API_KEY,
  umami: {
    apiUrl: process.env.UMAMI_API_URL || '',
    username: process.env.UMAMI_USERNAME || '',
    password: process.env.UMAMI_PASSWORD || '',
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
});

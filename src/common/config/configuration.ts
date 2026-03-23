export default () => ({
  port: parseInt(process.env.PORT, 10) || 8080,
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
});

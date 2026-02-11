export default () => ({
  port: parseInt(process.env.PORT, 10) || 8080,
  MAPBOX_API_KEY: process.env.MAPBOX_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  REDIS_URL: process.env.REDIS_URL,
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL_SECONDS, 10) || 60, // 60 seconds
    limit: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60, // 60 request per minute
  },
  internalApiKey: process.env.INTERNAL_API_KEY || '',
});

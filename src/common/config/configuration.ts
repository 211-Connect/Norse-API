export default () => ({
  port: parseInt(process.env.PORT, 10) || 8080,
  MAPBOX_API_KEY: process.env.MAPBOX_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  REDIS_URL: process.env.REDIS_URL,
});

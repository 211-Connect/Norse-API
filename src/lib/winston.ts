import winston from 'winston';

export const logger = winston.createLogger({
  // Here we are adding a custom level called `search`
  // so that we can log search queries alongside other
  // messages
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    search: 4,
    verbose: 5,
    debug: 6,
  },
  transports: [],
});

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  logger.add(
    new winston.transports.Console({
      level: 'error',
      format: winston.format.simple(),
    }),
  );
} else {
  // If we're not in production then log to the `console` with the console transport
  logger.add(
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.simple(),
    }),
  );
}

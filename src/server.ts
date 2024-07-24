import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';

import apiRoutes from './routes';
import redisClient from './lib/redis';
import { connect as mongooseClient } from './lib/mongoose';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './lib/winston';
import { rateLimiter } from './middleware/rateLimiter';

async function start() {
  console.log(process.env.ELASTIC_NODE);

  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const app = express();

  await redisClient.connect();
  await mongooseClient();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  // TODO: Gather metrics so that we can rate limit better
  // This is a general place holder for now
  app.use(rateLimiter(1000));

  app.get('/__health', (_req, res) => {
    res.sendStatus(200);
  });

  app.use('/', apiRoutes);
  app.use(errorHandler);

  app.listen(port, () => {
    logger.debug(`[ ready ] *:${port}`);
  });
}

start();

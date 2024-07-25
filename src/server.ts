import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';

import apiRoutes from './routes';
import redisClient from './lib/redis';
import { connect as mongooseClient } from './lib/mongoose';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './lib/winston';

async function start() {
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const app = express();

  await redisClient.connect();
  await mongooseClient();

  app.set('trust proxy', true);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors());
  app.use(compression());
  app.use(express.json());

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

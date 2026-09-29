import { INestApplication, PayloadTooLargeException } from '@nestjs/common';
import { json } from 'body-parser';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const INTERNAL_SERVICES_PATH = '/internal/services';
export const INTERNAL_SERVICES_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * The internal services routes take up to 5 MB of JSON (every other route
 * keeps Express's 100 kB). Must be applied before the app initialises, so it
 * parses these bodies ahead of Nest's global parser.
 */
export function useInternalServicesBodyLimit(app: INestApplication): void {
  const parse = json({ limit: INTERNAL_SERVICES_BODY_LIMIT_BYTES });
  // Nest skips its global JSON parser when a layer is named `jsonParser`.
  const internalServicesJson: RequestHandler = (req, res, next) =>
    parse(req, res, next);
  app.use(INTERNAL_SERVICES_PATH, internalServicesJson, tooLarge);
}

function tooLarge(
  err: { type?: string },
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err?.type !== 'entity.too.large') return next(err);
  const refusal = new PayloadTooLargeException(
    `The request body exceeds ${INTERNAL_SERVICES_BODY_LIMIT_BYTES / 1024 / 1024} MB, the limit for ${INTERNAL_SERVICES_PATH}; send a Withholding by reference (exclude.withholdings) instead of its serviceIds`,
  );
  res.status(refusal.getStatus()).json(refusal.getResponse());
}

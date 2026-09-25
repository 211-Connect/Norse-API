import {
  BadGatewayException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errors } from '@elastic/elasticsearch';

export interface EsCallOptions {
  /** Names the call in the log and the error message, e.g. `Region search`. */
  label: string;
  logger: Logger;
  /** Turns a known ES failure into a specific HttpException; null falls through. */
  mapError?: (error: unknown) => HttpException | null;
}

/**
 * Runs one Elasticsearch call with the repo's downstream error mapping: an
 * HttpException passes through, a timeout is 503, anything else is 502.
 */
export async function callElasticsearch<T>(
  { label, logger, mapError }: EsCallOptions,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    const mapped = mapError?.(error);
    if (mapped) throw mapped;
    if (error instanceof errors.TimeoutError) {
      logger.error(`${label} timed out`);
      throw new ServiceUnavailableException(`${label} timed out`);
    }
    logger.error(`${label} failed: ${error?.message}`);
    throw new BadGatewayException(`${label} failed`);
  }
}

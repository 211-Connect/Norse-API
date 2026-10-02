import { SetMetadata } from '@nestjs/common';

export const SKIP_METRICS_KEY = 'skip_metrics';

/**
 * Marks a route as excluded from HTTP request metrics.
 * Use on health checks and other probe endpoints.
 */
export const SkipMetrics = () => SetMetadata(SKIP_METRICS_KEY, true);

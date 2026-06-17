export interface TimeWindow {
  startMs: number;
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
}

export function timeWindow(start: string, end: string): TimeWindow {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error(`Invalid date range: ${start}..${end}`);
  }

  const rangeMs = endMs - startMs;
  const prevEndMs = startMs;
  const prevStartMs = startMs - rangeMs;

  return { startMs, endMs, prevStartMs, prevEndMs };
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
}

export interface TimeWindowSuccess {
  success: true;
  timeWindow: TimeWindow;
}

export interface TimeWindowFailure {
  success: false;
  error: string;
}

export type TimeWindowResult = TimeWindowSuccess | TimeWindowFailure;

export function timeWindow(start: string, end: string): TimeWindowResult {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return {
      success: false,
      error: `Invalid date range: ${start}..${end}`,
    };
  }

  const rangeMs = endMs - startMs;
  const prevEndMs = startMs;
  const prevStartMs = startMs - rangeMs;

  return {
    success: true,
    timeWindow: { startMs, endMs, prevStartMs, prevEndMs },
  };
}

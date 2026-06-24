export interface UmamiEventPayload {
  name: string;
  data?: Record<string, unknown>;
}

export interface UmamiSendResponse {
  cache: string;
  sessionId: string;
  visitId: string;
}

export interface UmamiBatchResponse {
  size: number;
  processed: number;
  errors: number;
  details: Array<{ index: number; error: string }>;
  cache: string;
}

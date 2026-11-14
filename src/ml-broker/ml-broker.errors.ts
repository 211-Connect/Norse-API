export type MlBrokerErrorKind =
  'unconfigured' | 'timeout' | 'http' | 'network' | 'malformed';

/**
 * Every failure of an ml-broker call. The message is built only from the
 * task, the kind, the HTTP status and an error name, so it is safe to log:
 * it never holds the request body (query text can be personal data), the
 * response body, or the api key.
 */
export class MlBrokerError extends Error {
  readonly name = 'MlBrokerError';

  constructor(
    readonly kind: MlBrokerErrorKind,
    readonly task: string,
    message: string,
    readonly status?: number,
  ) {
    super(`ml-broker ${task} ${kind}: ${message}`);
  }
}

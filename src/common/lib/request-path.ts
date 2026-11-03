/**
 * Request path for logs: never the query string. Search text, locations and
 * coordinates travel in the query string of the 211 directory (crisis-services
 * data), so a log line or span attribute must carry the path only.
 *
 * Accepts express's `originalUrl`/`url` (relative) and absolute URLs; for
 * absolute URLs the origin is kept (it is not sensitive) and userinfo,
 * query and fragment are dropped.
 */
export function requestPathForLog(request: {
  originalUrl?: string;
  url?: string;
}): string {
  const raw = request.originalUrl ?? request.url ?? '/';
  const withoutFragment = raw.split('#')[0];

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(withoutFragment)) {
    try {
      const parsed = new URL(withoutFragment);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      // Not parseable as an absolute URL: fall through to path handling.
    }
  }

  const queryStart = withoutFragment.indexOf('?');
  const path =
    queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  return path.length > 0 ? path : '/';
}

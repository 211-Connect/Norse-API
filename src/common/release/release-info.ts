/**
 * Which build is answering (ISS-2482). Set at image build time from the git
 * release tag and commit (Dockerfile ARGs, passed by deploy.yaml), so a
 * consumer can tell a change in Norse-API apart from a change in their own
 * code, and match a release note to what is live.
 *
 * Not the API contract version: that is `x-api-version` (still `1`). This is
 * the release (`v1.3.0`) that serves it.
 */
export const RELEASE_HEADER = 'x-norse-api-release';

const UNKNOWN = 'unknown';

export interface ReleaseInfo {
  release: string;
  commit: string;
}

/**
 * Read per call, not at import: a build without the ARGs (local, tests)
 * reports `unknown` rather than a stale or guessed value.
 */
export function releaseInfo(): ReleaseInfo {
  return {
    release: process.env.APP_VERSION?.trim() || UNKNOWN,
    commit: process.env.GIT_SHA?.trim() || UNKNOWN,
  };
}

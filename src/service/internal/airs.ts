/**
 * AIRS/HSIS taxonomy code structure, ported verbatim from ServiceNet
 * `packages/oss/sharing-contracts/src/airs.ts` so the facets route builds the
 * same tree the Mongo adapter built. The hierarchy is encoded in the code's own
 * separators, never in a string prefix: `BD-18` is a sibling of `BD-1800`, not
 * its ancestor. Keep the two copies in step.
 */

export function normalizeAirsCode(code: string): string {
  return code.trim().replace(/[.\-]+$/, '');
}

/**
 * Tests structure, not segment widths: the published AIRS spec (`ND-160.200-80`)
 * uses narrower segments than staging (`BD-1800.8200-250`), and both are AIRS.
 * A free-text label (`Serbo-Croatian`) is not, and must not be cut into branches.
 */
export function isAirsCode(code: string): boolean {
  return /^[A-Z]{2}(-[0-9]+(\.[0-9]+(-[0-9]+(\.[0-9]+)?)?)?)?$/.test(
    normalizeAirsCode(code),
  );
}

/** Every ancestor of a code, including the code itself, nearest-first. */
export function expandAirsCode(code: string): string[] {
  const trimmed = normalizeAirsCode(code);
  if (trimmed === '') return [];
  if (!isAirsCode(trimmed)) return [trimmed];

  const out: string[] = [trimmed];
  let current = trimmed;
  for (;;) {
    const cut = Math.max(current.lastIndexOf('.'), current.lastIndexOf('-'));
    if (cut <= 0) break;
    current = normalizeAirsCode(current.slice(0, cut));
    if (current === '' || out.includes(current)) break;
    out.push(current);
  }
  return out;
}

export function airsParent(code: string): string | null {
  const expanded = expandAirsCode(code);
  return expanded.length > 1 ? (expanded[1] ?? null) : null;
}

export interface AirsTreeNode {
  code: string;
  parentCode: string | null;
  recordCount: number;
  synthesized: boolean;
}

/**
 * The picker tree from ALREADY-EXPANDED path counts: grouping over the
 * ancestor-expanded `taxonomyPath` already yields "records at or under this
 * node", so nothing is re-derived and nothing is double-counted.
 */
export function buildAirsTreeFromPathCounts(
  pathCounts: readonly { code: string; recordCount: number }[],
  codedCodes: ReadonlySet<string>,
): AirsTreeNode[] {
  return pathCounts
    .map(({ code, recordCount }) => ({
      code,
      parentCode: airsParent(code),
      recordCount,
      synthesized: !codedCodes.has(code),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

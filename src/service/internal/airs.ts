/**
 * Ported verbatim from ServiceNet `sharing-contracts/src/airs.ts` so facets build
 * the tree the Mongo adapter built; keep the two in step. Hierarchy follows
 * separators, never string prefix: `BD-18` is a sibling of `BD-1800`.
 */

export function normalizeAirsCode(code: string): string {
  return code.trim().replace(/[.\-]+$/, '');
}

/** Structure, not segment widths: `ND-160.200-80` and `BD-1800.8200-250` both qualify; `Serbo-Croatian` does not. */
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

/** From ancestor-expanded path counts, which already mean "at or under this node". */
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

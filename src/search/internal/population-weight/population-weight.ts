/**
 * Population weight (ISS-2693). A "who it is for" taxonomy code (Men, Older
 * Adults, Veterans) keeps its boost only when the query text names that group.
 * Otherwise its score is multiplied by a weight. Nothing is hidden: only the
 * extra boost goes away. Pure functions, no Nest, no I/O.
 */

/**
 * HSIS branches that hold "who it is for" codes: YB age groups, YS sex and
 * gender, YT orientation and gender identity, YN military. A tenant with its
 * own taxonomy uses other code prefixes and gets no effect.
 */
export const IDENTITY_BRANCHES = ['YB', 'YS', 'YT', 'YN'];

/**
 * Measured in the ISS-2693 eval of 2026-11-14: weight 0 gave 0 guard rows
 * worse; abuser programs in a victim's top 3 fall from 7 to 4.
 */
export const POPULATION_WEIGHT = 0;

export interface WeightablePrediction {
  code: string;
  name: string;
  score: number;
  useReferences?: string[];
}

export function normalizeToken(tok: string): string {
  let t = tok.toLowerCase().replace(/['’]/g, '');
  if (t.endsWith('man')) t = t.slice(0, -3) + 'men';
  if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return t;
}

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/[A-Za-z0-9']+/g) ?? []) {
    out.add(normalizeToken(m));
  }
  return out;
}

/** The names of the identity parts of a (possibly compound) code, or ''. */
export function identityLabel(code: string, name: string): string {
  let codes = code.split('*').map((s) => s.trim());
  let names = name.split('*').map((s) => s.trim());
  if (codes.length !== names.length) {
    codes = [code.trim()];
    names = [name.trim()];
  }
  const taken: string[] = [];
  codes.forEach((c, i) => {
    if (IDENTITY_BRANCHES.some((b) => c.startsWith(b))) taken.push(names[i]);
  });
  return taken.join(' ');
}

export function groupWords(
  label: string,
  useReferences: string[],
): Set<string> {
  const out = new Set<string>();
  for (const text of [label, ...useReferences]) {
    for (const t of tokenize(text)) if (t.length >= 3) out.add(t);
  }
  return out;
}

export function applyPopulationWeight<T extends WeightablePrediction>(
  predicted: T[],
  queryText: string | undefined,
  weight: number = POPULATION_WEIGHT,
): T[] {
  if (!queryText || !queryText.trim()) return predicted;
  const queryTokens = tokenize(queryText);
  return predicted.map((p) => {
    const label = identityLabel(p.code, p.name);
    if (!label) return p;
    const words = groupWords(label, p.useReferences ?? []);
    for (const w of words) if (queryTokens.has(w)) return p;
    return { ...p, score: p.score * weight };
  });
}

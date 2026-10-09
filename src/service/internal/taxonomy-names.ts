/**
 * How a writer's taxonomy term reference becomes one name per code, shared by
 * the facets and the name lookup so the two cannot drift (ISS-2165).
 */

export interface NamedTerm {
  name: string;
  isAncestor: boolean;
}

/** One writer's code held in two taxonomies: its own term over a derived ancestor, then the lowest name. */
export function preferredTerm(a: NamedTerm, b: NamedTerm): NamedTerm {
  if (a.isAncestor !== b.isAncestor) return a.isAncestor ? b : a;
  return b.name < a.name ? b : a;
}

/** Several writers naming one code: the most common name, a tie to the lowest; null when none names it. */
export function mostCommonName(names: Iterable<string>): string | null {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const [name, count] of counts) {
    if (
      best === null ||
      count > best[1] ||
      (count === best[1] && name < best[0])
    ) {
      best = [name, count];
    }
  }
  return best?.[0] ?? null;
}

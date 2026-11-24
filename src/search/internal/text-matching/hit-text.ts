/** The taxonomy names of one hit's `_source`. */
export function taxonomyNames(source: Record<string, unknown>): string[] {
  const list = source.taxonomies;
  return (Array.isArray(list) ? list : [])
    .map((t) => (t as { name?: unknown } | null)?.name)
    .filter((n): n is string => typeof n === 'string');
}

/** One hit's `_source` as text: name, description, summary, taxonomy names. */
export function hitText(source: unknown): string {
  const src = (source ?? {}) as Record<string, unknown>;
  return [src.name, src.description, src.summary, ...taxonomyNames(src)]
    .filter((x): x is string => typeof x === 'string')
    .join(' ');
}

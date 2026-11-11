/**
 * Elasticsearch's `_english_` stop list (33 words) has no pronouns. Service
 * text is written in the third person, so document counts alone call "my"
 * rare. This list is the query-side correction: Snowball English stop words
 * plus apostrophe-less contractions.
 */
export const FUNCTION_WORDS_EN: ReadonlySet<string> = new Set(
  (
    'i me my myself we our ours ourselves you your yours yourself yourselves ' +
    'he him his himself she her hers herself it its itself they them their ' +
    'theirs themselves what which who whom this that these those am is are ' +
    'was were be been being have has had having do does did doing a an the ' +
    'and but if or because as until while of at by for with about against ' +
    'between into through during before after above below to from up down in ' +
    'out on off over under again further then once here there when where why ' +
    'how all any both each few more most other some such no nor not only own ' +
    'same so than too very s t can will just don should now im ive youre hes ' +
    'shes theyre dont doesnt didnt isnt arent wasnt cant wont'
  ).split(' '),
);

export const MAX_RARITY_WORDS = 12;

export const WORD_RARITY_FIELDS = [
  'name',
  'description',
  'service.name',
  'service.description',
  'organization.name',
];

export function queryWords(q: string): string[] {
  const tokens = q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}

export function contentWords(q: string, lang: string): string[] {
  const words = queryWords(q);
  const kept =
    lang === 'en' ? words.filter((w) => !FUNCTION_WORDS_EN.has(w)) : words;
  return kept.slice(0, MAX_RARITY_WORDS);
}

export function idf(totalDocs: number, docFreq: number): number {
  return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}

export const MIN_JOIN_LENGTH = 5;
export const MAX_JOINS = 20;

/**
 * Every span of 2 or 3 adjacent query words (function words included), run
 * together. "food bank near me" gives "foodbank", "foodbanknear", "banknear",
 * "nearme", and so on. Deduped, joins under 5 characters dropped, at most 20.
 */
export function adjacentJoins(q: string): { join: string; words: string[] }[] {
  const words = queryWords(q);
  const out: { join: string; words: string[] }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const len of [2, 3]) {
      if (i + len > words.length) continue;
      const span = words.slice(i, i + len);
      const join = span.join('');
      if (join.length < MIN_JOIN_LENGTH || seen.has(join)) continue;
      seen.add(join);
      out.push({ join, words: span });
      if (out.length >= MAX_JOINS) return out;
    }
  }
  return out;
}

export const MIN_SPLIT_WORD = 6;
export const MIN_SPLIT_PART = 3;

/** Every way to cut one word into two parts of 3+ characters ("foodbank" -> "food bank"). */
export function splitCandidates(word: string): string[] {
  if (word.length < MIN_SPLIT_WORD || /\d/.test(word)) return [];
  const out: string[] = [];
  for (let i = MIN_SPLIT_PART; i <= word.length - MIN_SPLIT_PART; i++) {
    out.push(`${word.slice(0, i)} ${word.slice(i)}`);
  }
  return out;
}

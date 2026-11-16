import { functionWordsFor } from './function-words';
import { queryWords } from './query-words';

export { queryWords };

export const MAX_RARITY_WORDS = 12;

export const WORD_RARITY_FIELDS = [
  'name',
  'description',
  'service.name',
  'service.description',
  'organization.name',
];

export function contentWords(q: string, lang: string): string[] {
  const words = queryWords(q);
  const functionWords = functionWordsFor(lang);
  const kept = functionWords
    ? words.filter((w) => !functionWords.has(w))
    : words;
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

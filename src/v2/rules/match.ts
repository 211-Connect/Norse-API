import { queryWords } from '../../search/internal/text-matching/query-words';
import {
  holdsWord,
  queryTokens,
} from '../../search/internal/text-matching/word-match';

/** What the returned hits say about the query words (the grid's second measure). */
export type Match = 'concentrated' | 'spread' | 'none';

export const MATCH = {
  // Per query word: the share of hits that hold it (see `wordsHeld`).
  textShareMin: 0.2,
  // Hits read.
  topN: 20,
  // A query with at least this many words needs `longHeldShareMin` of its
  // words held (each by `textShareMin` of the hits); a shorter one every word.
  longQueryMinWords: 3,
  longHeldShareMin: 0.5,
};

/**
 * Spanish request words: the hits need not hold them. Only here, because they
 * can be part of an org name ('Ayuda Legal').
 */
const SPANISH_REQUEST_WORDS = new Set([
  'necesito',
  'necesitamos',
  'ayuda',
  'ayudar',
  'quiero',
  'queremos',
  'busco',
  'buscar',
  'encontrar',
  'favor',
  'cerca',
]);

/** The words the hits must hold: the thing asked for. */
const askedWords = (words: string[]): string[] =>
  queryTokens(words).filter((w) => !SPANISH_REQUEST_WORDS.has(w));

/** Per query token, the share of hit texts that hold it. */
export function wordCoverage(words: string[], texts: string[]): number[] {
  const qt = askedWords(words);
  if (qt.length === 0 || texts.length === 0) return [];
  const sets = texts.map((t) => new Set(queryWords(t)));
  return qt.map(
    (t) => sets.filter((ws) => holdsWord(t, ws)).length / texts.length,
  );
}

/** The hits hold the query words (a short query: every word; a long one: half of them). */
export function wordsHeld(cov: number[]): boolean {
  if (cov.length === 0) return true;
  if (cov.length < MATCH.longQueryMinWords) {
    return Math.min(...cov) >= MATCH.textShareMin;
  }
  const held = cov.filter((c) => c >= MATCH.textShareMin).length;
  return held / cov.length >= MATCH.longHeldShareMin;
}

/**
 * `named`: the keyword list names an org and no veto took the claim. No query
 * tokens or no hits is no claim about the query (browse): `spread`.
 */
export function matchOf(i: {
  words: string[];
  texts: string[];
  named: boolean;
}): Match {
  return matchValue({
    words: i.words,
    hit_count: i.texts.length,
    words_held: wordsHeld(wordCoverage(i.words, i.texts)),
    named: i.named,
  });
}

/** The match value from saved measures (the judge spec reads these). */
export function matchValue(i: {
  words: string[];
  hit_count: number;
  words_held: boolean;
  named: boolean;
}): Match {
  // The claim is about the query: a page past the last hit keeps it.
  if (i.named) return 'concentrated';
  if (askedWords(i.words).length === 0 || i.hit_count === 0) return 'spread';
  return i.words_held ? 'spread' : 'none';
}

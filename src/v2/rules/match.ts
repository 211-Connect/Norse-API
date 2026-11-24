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
 * Spanish joining words: the hits need not hold them ('ayuda con renta' on an
 * English page). Only here: in the name match they are name words ('Con Edison').
 */
const JOINING_WORDS = new Set(['por', 'para', 'con']);

/** The query words the hits must hold: no request words, no ZIP, no joining words. */
export const coverageTokens = (words: string[]): string[] =>
  queryTokens(words).filter((w) => !JOINING_WORDS.has(w));

/**
 * The words of the caller's query that name the topic, for the spread stem.
 * The topic is the set of `coverageTokens(contentWords)`. The text runs from the
 * first to the last topic token of `query`; inside it request words are dropped
 * and the rest stays ('Comida y renta'), in the caller's spelling. No query, or
 * no topic token in it: the topic tokens joined by a space.
 */
export function topicText(
  query: string | undefined,
  contentWords: string[],
): string {
  const topicTokens = coverageTokens(contentWords);
  const topic = new Set(topicTokens);
  const fallback = topicTokens.join(' ');
  if (!query) return fallback;
  const isTopic = (t: string): boolean =>
    queryWords(t).some((f) => topic.has(f));
  const seen = new Set<string>();
  // A repeated topic word shows once ('food, food').
  const tokens = query
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}'’]+/u)
    .filter((t) => {
      if (t.length === 0) return false;
      const key = queryWords(t).join(' ');
      if (isTopic(t) && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const first = tokens.findIndex(isTopic);
  if (first === -1) return fallback;
  const last = tokens.length - 1 - [...tokens].reverse().findIndex(isTopic);
  const inContent = new Set(contentWords);
  return tokens
    .slice(first, last + 1)
    .filter((t) => isTopic(t) || !queryWords(t).some((f) => inContent.has(f)))
    .join(' ');
}

/** Per query token, the share of hit texts that hold it. */
export function wordCoverage(words: string[], texts: string[]): number[] {
  const qt = coverageTokens(words);
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

/** The match value from saved measures (hit count and words). */
export function matchValue(i: {
  words: string[];
  hit_count: number;
  words_held: boolean;
  named: boolean;
}): Match {
  // The claim is about the query: a page past the last hit keeps it.
  if (i.named) return 'concentrated';
  if (coverageTokens(i.words).length === 0 || i.hit_count === 0)
    return 'spread';
  return i.words_held ? 'spread' : 'none';
}

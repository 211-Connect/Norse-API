import { queryWords } from './query-words';

/**
 * Words of a request that say nothing about the thing asked for. Hits do not
 * need to hold them ('i need food and housing' is about food and housing), and
 * they are no part of an org name. The one list, English and Spanish: the word
 * coverage and the name match both read it, and a query can mix languages. No
 * joining words ('con', 'para', 'el'): names start with them ('Con Edison').
 * Accents are already removed (`queryWords`).
 */
const REQUEST_WORDS = new Set([
  'i',
  'im',
  'me',
  'my',
  'we',
  'need',
  'needs',
  'help',
  'want',
  'looking',
  'find',
  'get',
  'please',
  'assistance',
  'near',
  'nearby',
  // Spanish.
  'necesito',
  'necesita',
  'necesitamos',
  'necesitan',
  'necesitar',
  'ayuda',
  'ayudar',
  'ayudame',
  'ayudarme',
  'ayudenme',
  'asistencia',
  'quiero',
  'quiere',
  'queremos',
  'quisiera',
  'busco',
  'busca',
  'buscamos',
  'buscan',
  'buscar',
  'buscando',
  'encontrar',
  'favor',
  'cerca',
  // Stop words: the hits need not hold them either ('i need food and housing').
  'and',
  'or',
  'the',
  'of',
  'for',
  'a',
  'an',
  'in',
  'to',
  'with',
  'at',
  'on',
]);

/** A US ZIP code names a place; the hits need not hold it as text. */
const isZip = (w: string): boolean => /^\d{5}$/.test(w);

export const queryTokens = (words: string[]): string[] =>
  words.filter((w) => w.length >= 2 && !REQUEST_WORDS.has(w) && !isZip(w));

const tokHit = (t: string, ts: string[]): boolean =>
  ts.some((n) => n === t || (t.length >= 4 && n.startsWith(t)));

/** Every query word is a word, or the start of one, of the text. */
export function holdsAllWords(words: string[], text: string): boolean {
  const qt = queryTokens(words);
  const ts = queryWords(text);
  return qt.length > 0 && qt.every((t) => tokHit(t, ts));
}

/** Damerau-Levenshtein distance of at most 1 (insert, delete, substitute, adjacent swap). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
    return (
      d.length === 1 ||
      (d.length === 2 &&
        d[1] === d[0] + 1 &&
        a[d[0]] === b[d[1]] &&
        a[d[1]] === b[d[0]])
    );
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/** The stem rule, or (5+ letters) a one-edit typo of a word of 4+ letters. */
export function holdsWord(t: string, words: Set<string>): boolean {
  const stem = t.slice(0, Math.max(4, t.length - 2));
  for (const w of words) {
    if (w === t || (t.length >= 4 && w.startsWith(stem))) return true;
  }
  if (t.length >= 5) {
    for (const w of words) {
      if (w.length >= 4 && withinOneEdit(t, w)) return true;
    }
  }
  return false;
}

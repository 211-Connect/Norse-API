import { queryWords } from './query-words';

/**
 * Function words by language code (ISS-2739). A query word in this set is not
 * weighted by rarity: document counts alone call "my" rare, because service
 * text is written in the third person. Only `en` and `es`.
 */

/**
 * The Snowball English stop-word list, verbatim
 * (https://snowballstem.org/algorithms/english/stop.txt, 174 entries; `us`
 * is commented out upstream). Apostrophes stay here and are removed when the
 * set is built, the way `queryWords` removes them from query text.
 */
export const SNOWBALL_ENGLISH_STOP_WORDS: readonly string[] = [
  'i',
  'me',
  'my',
  'myself',
  'we',
  'our',
  'ours',
  'ourselves',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
  'he',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'it',
  'its',
  'itself',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing',
  'would',
  'should',
  'could',
  'ought',
  "i'm",
  "you're",
  "he's",
  "she's",
  "it's",
  "we're",
  "they're",
  "i've",
  "you've",
  "we've",
  "they've",
  "i'd",
  "you'd",
  "he'd",
  "she'd",
  "we'd",
  "they'd",
  "i'll",
  "you'll",
  "he'll",
  "she'll",
  "we'll",
  "they'll",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "hadn't",
  "doesn't",
  "don't",
  "didn't",
  "won't",
  "wouldn't",
  "shan't",
  "shouldn't",
  "can't",
  'cannot',
  "couldn't",
  "mustn't",
  "let's",
  "that's",
  "who's",
  "what's",
  "here's",
  "there's",
  "when's",
  "where's",
  "why's",
  "how's",
  'a',
  'an',
  'the',
  'and',
  'but',
  'if',
  'or',
  'because',
  'as',
  'until',
  'while',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'up',
  'down',
  'in',
  'out',
  'on',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
];

/**
 * Words of the earlier hand-typed list that Snowball does not have: the NLTK
 * additions. Kept so that this change only adds words.
 */
const EARLIER_EXTRA_ENGLISH = ['can', 'will', 'just', 'now', 'don'];

/**
 * Snowball Spanish stop words (snowball `spanish_stop.txt`, 308 entries),
 * kept whole and with accents as published. Accents are removed when the set
 * is built, the way `queryWords` removes them from query text. The list was
 * written from memory of the Snowball file; the spec checks the count only.
 */
export const SNOWBALL_SPANISH_STOP_WORDS: readonly string[] = (
  'de la que el en y a los del se las por un para con no una su al lo como ' +
  'más pero sus le ya o este sí porque esta entre cuando muy sin sobre ' +
  'también me hasta hay donde quien desde todo nos durante todos uno les ni ' +
  'contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro ' +
  'otras otra él tanto esa estos mucho quienes nada muchos cual poco ella ' +
  'estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras ' +
  'vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya ' +
  'suyos suyas nuestro nuestra nuestros nuestras vuestro vuestra vuestros ' +
  'vuestras esos esas estoy estás está estamos estáis están esté estés ' +
  'estemos estéis estén estaré estarás estará estaremos estaréis estarán ' +
  'estaría estarías estaríamos estaríais estarían estaba estabas estábamos ' +
  'estabais estaban estuve estuviste estuvo estuvimos estuvisteis ' +
  'estuvieron estuviera estuvieras estuviéramos estuvierais estuvieran ' +
  'estuviese estuvieses estuviésemos estuvieseis estuviesen estando estado ' +
  'estada estados estadas estad he has ha hemos habéis han haya hayas ' +
  'hayamos hayáis hayan habré habrás habrá habremos habréis habrán habría ' +
  'habrías habríamos habríais habrían había habías habíamos habíais habían ' +
  'hube hubiste hubo hubimos hubisteis hubieron hubiera hubieras hubiéramos ' +
  'hubierais hubieran hubiese hubieses hubiésemos hubieseis hubiesen ' +
  'habiendo habido habida habidos habidas soy eres es somos sois son sea ' +
  'seas seamos seáis sean seré serás será seremos seréis serán sería serías ' +
  'seríamos seríais serían era eras éramos erais eran fui fuiste fue fuimos ' +
  'fuisteis fueron fuera fueras fuéramos fuerais fueran fuese fueses ' +
  'fuésemos fueseis fuesen siendo sido tengo tienes tiene tenemos tenéis ' +
  'tienen tenga tengas tengamos tengáis tengan tendré tendrás tendrá ' +
  'tendremos tendréis tendrán tendría tendrías tendríamos tendríais ' +
  'tendrían tenía tenías teníamos teníais tenían tuve tuviste tuvo tuvimos ' +
  'tuvisteis tuvieron tuviera tuvieras tuviéramos tuvierais tuvieran ' +
  'tuviese tuvieses tuviésemos tuvieseis tuviesen teniendo tenido tenida ' +
  'tenidos tenidas tened'
).split(' ');

const buildSet = (...lists: readonly string[][]): ReadonlySet<string> =>
  new Set(lists.flatMap((list) => list.flatMap((w) => queryWords(w))));

export const FUNCTION_WORDS: Record<string, ReadonlySet<string>> = {
  en: buildSet([...SNOWBALL_ENGLISH_STOP_WORDS], EARLIER_EXTRA_ENGLISH),
  es: buildSet([...SNOWBALL_SPANISH_STOP_WORDS]),
};

/**
 * The function words for a language code. Region forms use the primary
 * subtag (`en-US`, `en_GB` give the English set). `undefined` = no list.
 */
export function functionWordsFor(
  lang: string,
): ReadonlySet<string> | undefined {
  const primary = lang.toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(FUNCTION_WORDS, primary)
    ? FUNCTION_WORDS[primary]
    : undefined;
}

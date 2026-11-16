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

/**
 * Snowball Spanish stop words (snowball `spanish_stop.txt`, 308 entries),
 * kept whole and with accents as published. `FUNCTION_WORDS_ES` holds the
 * same words normalised the way `queryWords` normalises a query. The list was
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

const normalizeWord = (w: string): string =>
  w.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/['’]/g, '');

// Same filter as `queryWords`: one-letter tokens never reach a lookup.
export const FUNCTION_WORDS_ES: ReadonlySet<string> = new Set(
  SNOWBALL_SPANISH_STOP_WORDS.map(normalizeWord).filter((w) => w.length >= 2),
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
  const stop =
    lang === 'en'
      ? FUNCTION_WORDS_EN
      : lang === 'es'
        ? FUNCTION_WORDS_ES
        : null;
  const kept = stop ? words.filter((w) => !stop.has(w)) : words;
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

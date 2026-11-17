/**
 * Population weight (ISS-2693). A "who it is for" taxonomy code (Men, Older
 * Adults, Veterans) keeps its boost only when the query ASKS FOR that group.
 * Otherwise its score is multiplied by a weight. Nothing is hidden: only the
 * extra boost goes away. Pure functions, no Nest, no I/O.
 *
 * English only: for any other query language the function returns its input
 * (see ../language-switches.ts).
 *
 * THE RULE. A code's group words are its identity label plus its
 * use_references. The code keeps its boost when at least one query word that
 * is a group word is a REQUEST mention and is not negated. Words are
 * normalized (man -> men, seniors -> senior), compared in order, and the
 * tests below use the raw (lowercase, accent-folded) words.
 *
 * A mention at position i is a request when ANY of these holds:
 *  1. FOR   "for" sits before it with at most 4 filler words between
 *           (a, an, the, my, our, his, her, their, your, some, all, other,
 *           and, or, homeless, poor, abused, battered, disabled, low, income,
 *           young, elderly, or another group word of the predicted codes):
 *           "for men", "for abused women". For sex and gender codes the
 *           articles a, an and the are NOT fillers: "for a man hit me" and
 *           "for the man who hit me" name an actor, not a request.
 *  2. SERVICE  the next words are service words and the run holds at least
 *           one service noun: "men's shelter", "senior housing",
 *           "veterans housing", "women support group", "men only shelter".
 *           A verb or a pronoun ends the run, so "a man hit me", "a man only
 *           hit me once" and "man keeps hitting" fail.
 *  3. ONLY  (age, military and other non-sex codes only) "only" is right
 *           before or right after: "veterans only", "only seniors". For sex
 *           and gender codes "only" does not count by itself, because
 *           "only men hit me" and "men only hit me when drunk" are actors.
 *  4. SELF  the speaker says it about self: "i am a man", "im a veteran",
 *           "as a senior", "we are seniors", "being a veteran", and with up
 *           to 3 describing words after a or an: "i am a very old man",
 *           "im a female veteran", "i am an undocumented woman". The
 *           describing words may not be a preposition, pronoun, verb, -ing
 *           word or person noun, and no comma or full stop may sit between
 *           the self words and the mention: "i am a woman, men hit me".
 *  5. WOMEN AND CHILDREN  "women and children" (either order) is a request
 *           for the Women code.
 *
 * 6. THIRD PARTY  (age, military and other non-sex codes only) a possessive
 *    sits right before it: "my elderly mother needs food". Not for older,
 *    younger, young, old, adult, little, big, grown. The pattern gives no
 *    boost when the query holds a violence or threat word anywhere (hit,
 *    beat, attack, threaten, abuse, hurt, harass, stalk, follow, ...):
 *    "my veteran husband hits me" names the abuser. Sex and gender codes
 *    never use this pattern.
 *
 * The SERVICE pattern also fails for a singular "man" or "woman" with a
 * violence word within 3 words after the run: "man group keeps following me".
 *
 * NEGATION. A mention is cancelled when a negator (not, no, non, never,
 * without, except, excluding, exclude, avoid, nor, isnt, arent, dont,
 * doesnt, cant, wont, "other than") sits before it, and every word between
 * the negator and the mention is a bridge word (for, to, be, is, are, just,
 * only, meant, intended, open, suitable, available, allowed, want, need,
 * any, place, one, a filler, or a service noun): "not for men", "no men",
 * "don't want men", "not a shelter for men". "no money, men's shelter" is
 * NOT cancelled ("money" is not a bridge word).
 *
 * A mention that is only an ACTOR ("a man hit me", "my ex is a violent
 * man", "my veteran husband") matches none of the patterns.
 *
 * COMPOUND CODES ("Homeless Shelter * Men"): when the identity part is not
 * requested, the score is multiplied by COMPOUND_NOT_NAMED_WEIGHT (the
 * service part keeps some boost) instead of POPULATION_WEIGHT. The two
 * options were measured in the ISS-2693 eval (see the PR).
 */

import { isFeatureOnForLanguage } from '../language-switches';
import { FUNCTION_WORDS } from '../text-matching/function-words';
import { queryWords } from '../text-matching/query-words';

// Group words come from English code names and references (HSIS).
const GROUP_STOP_WORDS: ReadonlySet<string> = FUNCTION_WORDS.en;

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

/**
 * Compound code whose identity part is not requested (c1 = 0: the whole code
 * is zeroed, c2 = 0.5: the service part keeps half). Chosen by the eval.
 */
export const COMPOUND_NOT_NAMED_WEIGHT = 0;

export interface PopulationWeightOptions {
  weight?: number;
  compoundWeight?: number;
}

export interface WeightablePrediction {
  code: string;
  name: string;
  score: number;
  useReferences?: string[];
}

// Irregular forms, mapped to one spelling so label and query agree.
const IRREGULAR: Readonly<Record<string, string>> = {
  man: 'men',
  woman: 'women',
  children: 'child',
  people: 'person',
};

export function normalizeToken(tok: string): string {
  const t = tok.toLowerCase().replace(/['’]/g, '');
  if (Object.prototype.hasOwnProperty.call(IRREGULAR, t)) return IRREGULAR[t];
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) {
    return t.slice(0, -1);
  }
  return t;
}

/** The same words word rarity sees (accent-folded, Unicode letters), normalized. */
export function tokenize(text: string): Set<string> {
  return new Set(queryWords(text).map(normalizeToken));
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
    for (const t of tokenize(text)) {
      if (t.length >= 3 && !GROUP_STOP_WORDS.has(t)) out.add(t);
    }
  }
  return out;
}

// ---- request patterns (the rule is described at the top of this file) ----

interface Tok {
  raw: string;
  norm: string;
  /** A comma, full stop, colon, semicolon, bracket, ! or ? follows this word. */
  brk: boolean;
}

/** Words in order, not deduped: lowercase, accent-folded, apostrophes dropped. */
function sequence(text: string): Tok[] {
  const clean = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '');
  const found = [...clean.matchAll(/[\p{L}\p{N}]+/gu)];
  return found.map((m, n) => {
    const end = (m.index ?? 0) + m[0].length;
    const next = found[n + 1]?.index ?? clean.length;
    return {
      raw: m[0],
      norm: normalizeToken(m[0]),
      brk: /[,.;:!?()\n]/.test(clean.slice(end, next)),
    };
  });
}

const set = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/));

/** Words allowed between "for" (or a negator) and the group word. */
const FILLERS = set(
  'a an the my our his her their your some all other and or just only ' +
    'specifically especially homeless poor abused battered disabled low ' +
    'income young elderly',
);
const NEGATORS = set(
  'not no non never without except excluding exclude avoid nor isnt arent ' +
    'dont doesnt cant wont',
);
const NEGATION_BRIDGE = set(
  'for to be is are just only meant intended open suitable available ' +
    'allowed want need any place one',
);
const SELF_VERBS = set('am are was were');
const SELF_SHORT = set('im as being');
const ARTICLES = set('a an');
const POSSESSIVES = set('my our his her their');
/** Not a person who needs help when it follows "my": "my older brother". */
const COMPARATIVES = set('older younger young old adult little big grown');
/** Violence and threat words (own list; no shared list exists in the repo). */
const VIOLENCE = set(
  'hit hits hitting beat beats beating beaten attack attacks attacked ' +
    'attacking threaten threatens threatened threatening abuse abuses ' +
    'abused abusing abusive hurt hurts hurting harass harasses harassed ' +
    'harassing stalk stalks stalked stalking follow follows followed ' +
    'following assault assaults assaulted assaulting violent punch punched ' +
    'slap slapped choke choked kill kills killed',
);
const hasViolence = (t: Tok[], from = 0, to = t.length): boolean =>
  t.slice(from, to).some((x) => VIOLENCE.has(x.raw));
const SELF_ADVERBS = set('just also now currently really truly');
/** Never a describing word in "i am a ___ man": links, verbs, pronouns, people. */
const NOT_DESCRIBING = set(
  'from by with of to at in on for about near after before into over under ' +
    'who that which when while because but so if and or not no the a an ' +
    'my our his her their your me him them us it he she they i we you ' +
    'is are was were am be been being has have had hit hits hurt hurts beat ' +
    'beats attack attacks man men woman women boy girl guy lady person people ' +
    'child children kid kids husband wife mother father mom dad partner ' +
    'victim survivor',
);

const SERVICE_NOUNS = set(
  'shelter housing home house apartment program service group clinic center ' +
    'centre assistance benefit resource counseling counselling therapy ' +
    'therapist treatment meal food pantry transportation ride job employment ' +
    'lawyer attorney recovery rehab detox bed residence hotline class ' +
    'training education daycare respite hospice rent utility voucher ' +
    'clothing mentoring advocacy organization agency charity ministry care ' +
    'healthcare',
);
/** Nouns that are also common verbs: "cares", "rents", "homes in" never count. */
const SINGULAR_ONLY = set('care rent house home food');
const SERVICE_MODIFIERS = set(
  'emergency affordable low income transitional temporary free subsidized ' +
    'public mental behavioral substance abuse domestic violence legal ' +
    'medical dental vision support health crisis permanent supportive ' +
    'independent assisted day senior-friendly only',
);

function isServiceNoun(raw: string): boolean {
  if (SERVICE_NOUNS.has(raw)) return true;
  for (const cut of [1, 2]) {
    const stem = raw.slice(0, -cut);
    if (
      raw.length > cut + 2 &&
      raw.endsWith(cut === 1 ? 's' : 'es') &&
      SERVICE_NOUNS.has(stem) &&
      !SINGULAR_ONLY.has(stem)
    ) {
      return true;
    }
  }
  return false;
}

interface Context {
  /** Group words of every identity code in the list (so "men and women" chains). */
  all: ReadonlySet<string>;
  /** Sex, gender and orientation codes: a possessive mention is an actor there. */
  actorProne: boolean;
}

/** 1. FOR: "for men", "for my veteran husband", "for abused women". */
function afterFor(t: Tok[], i: number, c: Context): boolean {
  for (let k = i - 1; k >= 0 && i - k <= 5; k--) {
    if (t[k].raw === 'for') return true;
    if (c.actorProne && ARTICLES.has(t[k].raw)) return false;
    if (c.actorProne && t[k].raw === 'the') return false;
    if (!FILLERS.has(t[k].raw) && !c.all.has(t[k].norm)) return false;
  }
  return false;
}

/** 2. SERVICE: "men's shelter", "senior housing", "women support group". */
function serviceRun(t: Tok[], i: number, c: Context): boolean {
  const end = serviceRunEnd(t, i, c);
  if (end === null) return false;
  // "man group keeps following me": a singular mention with a violence word
  // within 3 words after the run names an actor, not a service request.
  const singular = t[i].raw === 'man' || t[i].raw === 'woman';
  return !(singular && hasViolence(t, end, end + 3));
}

function serviceRunEnd(t: Tok[], i: number, c: Context): number | null {
  let noun = false;
  let k = i + 1;
  for (; k < t.length && k <= i + 4; k++) {
    const raw = t[k].raw;
    if (isServiceNoun(raw)) {
      noun = true;
    } else if (
      !SERVICE_MODIFIERS.has(raw) &&
      !c.all.has(t[k].norm) &&
      raw !== 'and' &&
      raw !== 'or'
    ) {
      break;
    }
  }
  return k > i + 1 && noun ? k : null;
}

/** 4. SELF: "i am a man", "im a veteran", "as a senior", "we are seniors". */
function selfDescribed(t: Tok[], i: number): boolean {
  return selfFillers(t, i) || selfDescribing(t, i);
}

function isSelfMarker(t: Tok[], k: number): boolean {
  const raw = t[k]?.raw;
  if (SELF_SHORT.has(raw ?? '')) return true;
  return SELF_VERBS.has(raw ?? '') && ['i', 'we'].includes(t[k - 1]?.raw ?? '');
}

function selfFillers(t: Tok[], i: number): boolean {
  let k = i - 1;
  while (k >= 0 && i - k <= 3 && FILLERS.has(t[k].raw)) k--;
  return k >= 0 && isSelfMarker(t, k);
}

/** "i am a very old man", "im a female veteran": a or an, then up to 3 describing words. */
function selfDescribing(t: Tok[], i: number): boolean {
  let k = i - 1;
  let n = 0;
  while (k >= 0 && n < 3 && isDescribing(t[k].raw)) {
    k--;
    n++;
  }
  if (k < 0 || !ARTICLES.has(t[k].raw)) return false;
  k--;
  while (k >= 0 && SELF_ADVERBS.has(t[k].raw)) k--;
  if (k < 0 || !isSelfMarker(t, k)) return false;
  for (let j = k; j < i; j++) if (t[j].brk) return false;
  return true;
}

function isDescribing(raw: string): boolean {
  return raw.length >= 2 && !NOT_DESCRIBING.has(raw) && !raw.endsWith('ing');
}

/** 5. WOMEN AND CHILDREN: "women and children shelter", "children and women". */
function womenAndChildren(t: Tok[], i: number): boolean {
  if (t[i].norm !== 'women') return false;
  const isKid = (r?: string) =>
    ['child', 'kid', 'family'].includes(normalizeToken(r ?? ''));
  const joined = (a: number) => t[a]?.raw === 'and' || t[a]?.raw === 'or';
  return (
    isKid(t[i + 1]?.raw) ||
    (joined(i + 1) && isKid(t[i + 2]?.raw)) ||
    isKid(t[i - 1]?.raw) ||
    (joined(i - 1) && isKid(t[i - 2]?.raw))
  );
}

function isNegated(t: Tok[], i: number, c: Context): boolean {
  for (let k = i - 1; k >= 0 && i - k <= 5; k--) {
    const raw = t[k].raw;
    if (NEGATORS.has(raw)) return true;
    if (raw === 'than' && t[k - 1]?.raw === 'other') return true;
    if (
      !NEGATION_BRIDGE.has(raw) &&
      !FILLERS.has(raw) &&
      !isServiceNoun(raw) &&
      !c.all.has(t[k].norm)
    ) {
      return false;
    }
  }
  return false;
}

function isRequest(t: Tok[], i: number, c: Context): boolean {
  return (
    afterFor(t, i, c) ||
    serviceRun(t, i, c) ||
    (!c.actorProne && (t[i + 1]?.raw === 'only' || t[i - 1]?.raw === 'only')) ||
    selfDescribed(t, i) ||
    womenAndChildren(t, i) ||
    (!c.actorProne &&
      POSSESSIVES.has(t[i - 1]?.raw ?? '') &&
      !COMPARATIVES.has(t[i].norm) &&
      !hasViolence(t))
  );
}

/** True when the query asks for the group, at least once and not negated. */
export function queryAsksForGroup(
  queryText: string,
  words: ReadonlySet<string>,
  all: ReadonlySet<string> = words,
  actorProne = false,
): boolean {
  const t = sequence(queryText);
  const c: Context = { all, actorProne };
  return t.some(
    (tok, i) =>
      words.has(tok.norm) && isRequest(t, i, c) && !isNegated(t, i, c),
  );
}

/** Identity parts of a code, each with its own code and name. */
function identityParts(
  code: string,
  name: string,
): { codes: string[]; identity: boolean[] } {
  let codes = code.split('*').map((s) => s.trim());
  const names = name.split('*').map((s) => s.trim());
  if (codes.length !== names.length) codes = [code.trim()];
  return {
    codes,
    identity: codes.map((c) => IDENTITY_BRANCHES.some((b) => c.startsWith(b))),
  };
}

export function applyPopulationWeight<T extends WeightablePrediction>(
  predicted: T[],
  queryText: string | undefined,
  lang: string | undefined,
  options: PopulationWeightOptions = {},
): T[] {
  if (!isFeatureOnForLanguage('populationWeight', lang)) return predicted;
  if (!queryText || !queryText.trim()) return predicted;
  const weight = options.weight ?? POPULATION_WEIGHT;
  const compoundWeight = options.compoundWeight ?? COMPOUND_NOT_NAMED_WEIGHT;
  const info = predicted.map((p) => {
    const label = identityLabel(p.code, p.name);
    if (!label) return null;
    const parts = identityParts(p.code, p.name);
    return {
      words: groupWords(label, p.useReferences ?? []),
      actorProne: parts.codes.some(
        (c, i) => parts.identity[i] && /^Y[ST]/.test(c),
      ),
      compound: parts.identity.some((x) => !x),
    };
  });
  const all = new Set<string>();
  for (const g of info) if (g) for (const w of g.words) all.add(w);
  return predicted.map((p, i) => {
    const g = info[i];
    if (!g) return p;
    if (queryAsksForGroup(queryText, g.words, all, g.actorProne)) return p;
    return { ...p, score: p.score * (g.compound ? compoundWeight : weight) };
  });
}

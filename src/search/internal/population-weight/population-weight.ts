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
 * 7. QUESTION  the group is the subject of get, find, apply, stay, qualify
 *    and similar in a question: "where can seniors get free meals", "do
 *    shelters take men". Not when the query holds a violence word.
 * 8. CARE STATEMENT  "my mom is elderly and needs meals", "my husband is a
 *    veteran and needs a job" (non-sex codes, same guards as 6).
 * 6. THIRD PARTY  (age, military and other non-sex codes only) a possessive
 *    sits right before it: "my elderly mother needs food". Not for older,
 *    younger, young, old, adult, little, big, grown. The pattern gives no
 *    boost when the query holds a violence or threat word anywhere (hit,
 *    beat, attack, threaten, abuse, hurt, harass, stalk, follow, ...):
 *    "my veteran husband hits me" names the abuser. The pattern also gives
 *    no boost when "me" or "my money/phone/..." follows the mention within 6
 *    words ("my elderly dad shoves me"), except after need and help verbs.
 *    Violence words match by stem ("chokes", "grabbed", "scares"). Sex and gender codes
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
  teenage: 'teen',
  teenager: 'teen',
};

export function normalizeToken(tok: string): string {
  const t = tok.toLowerCase().replace(/['’]/g, '');
  if (Object.prototype.hasOwnProperty.call(IRREGULAR, t)) return IRREGULAR[t];
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) {
    const stem = t.slice(0, -1);
    return Object.prototype.hasOwnProperty.call(IRREGULAR, stem)
      ? IRREGULAR[stem]
      : stem;
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
    'allowed want need any place one take takes accept accepts allow allows house houses',
);
const SELF_VERBS = set('am are was were');
const SELF_SHORT = set('im as being');
const ARTICLES = set('a an');
const POSSESSIVES = set('my our his her their');
/** Not a person who needs help when it follows "my": "my older brother". */
const COMPARATIVES = set('older younger young old adult little big grown');
/**
 * Violence and threat words, matched by stem at the start of the word (own
 * list; no shared list exists in the repo). "rap" matches only rape forms, so
 * "rapid" and "therapy" do not match. "shot" is skipped after flu, covid and
 * similar words.
 */
const VIOLENCE_RE = new RegExp(
  '^(hit|hits|hitting|beat|beats|beating|beaten|attack|threat|abus|hurt|' +
    'harass|stalk|assault|violen|punch|slap|chok|strangl|molest|kick|shov|' +
    'grab|stab|shoot|kill|afraid|follow(s|ed|ing)?$|' +
    'rap(e|es|ed|ing|ist|ists)$|scar(e|es|ed|y|ing)$|shot$)',
);
const NOT_THAT_SHOT = set('flu covid booster vaccine tetanus allergy free');
const isViolence = (t: Tok[], k: number): boolean => {
  const raw = t[k].raw;
  if (!VIOLENCE_RE.test(raw)) return false;
  return !(raw === 'shot' && NOT_THAT_SHOT.has(t[k - 1]?.raw ?? ''));
};
/** Violence words that are not excused for this mention (see excusedFor). */
const hasViolence = (
  t: Tok[],
  c: Context,
  from = 0,
  to = t.length,
): boolean => {
  for (let k = from; k < Math.min(to, t.length); k++) {
    if (isViolence(t, k) && !c.excused.has(k)) return true;
  }
  return false;
};

// ---- abuse-service phrases and passive victims (they excuse violence words) ----

const ABUSE_AFTER = set(
  'hotline hotlines shelter shelters counseling counselling reporting ' +
    'victim victims survivor survivors',
);
const TRAILING = set(
  'victim victims survivor survivors hotline hotlines shelter shelters reporting counseling counselling',
);

interface Span {
  s: number;
  e: number;
}

/**
 * Phrases that mark a request FOR an abuse service: "domestic violence",
 * "dating violence", "elder/senior abuse", "sexual assault", "abuse
 * hotline/shelter/counseling/reporting/victim/survivor", "fleeing" (with
 * abuse or violence after it), "battered", "military sexual trauma". A
 * trailing victim/survivor/shelter/hotline word joins the span.
 */
function phraseSpans(t: Tok[]): Span[] {
  const out: Span[] = [];
  const at = (k: number) => t[k]?.raw ?? '';
  for (let k = 0; k < t.length; k++) {
    let e = 0;
    const r = at(k);
    const r1 = at(k + 1);
    if (
      ['domestic', 'dating', 'intimate'].includes(r) &&
      ['violence', 'abuse'].includes(r1)
    )
      e = k + 2;
    else if (r === 'intimate' && r1 === 'partner' && at(k + 2) === 'violence')
      e = k + 3;
    else if (['elder', 'senior', 'elderly'].includes(r) && r1 === 'abuse')
      e = k + 2;
    else if (r === 'sexual' && r1 === 'assault') e = k + 2;
    else if (r === 'military' && r1 === 'sexual' && at(k + 2) === 'trauma')
      e = k + 3;
    else if (r === 'abuse' && ABUSE_AFTER.has(r1)) e = k + 2;
    else if (r === 'fleeing') {
      e = k + 1;
      if (['abuse', 'violence'].includes(r1)) e = k + 2;
      else if (r1 === 'domestic' && ['violence', 'abuse'].includes(at(k + 2)))
        e = k + 3;
    } else if (r === 'battered') e = k + 1;
    if (e) {
      while (TRAILING.has(at(e))) e++;
      out.push({ s: k, e });
      k = e - 1;
    }
  }
  return out;
}

const PASSIVE_AUX = set('was were is are being been got gets who that');
const PASSIVE_PARTICIPLES = set(
  'hit beaten beat assaulted raped abused attacked harassed stalked molested ' +
    'hurt injured threatened killed shot stabbed',
);
const IN_SERVICE = set('service military combat');

/**
 * Index of the passive participle that says the group member is the VICTIM:
 * "my elderly mother is being hit by her aide", "veterans who were raped in
 * the military", "veteran assaulted in service". Starts right after the
 * mention. Without an auxiliary the participle needs "in service/military".
 */
function passiveVictim(t: Tok[], i: number): number | null {
  let k = i + 1;
  let aux = false;
  // skip up to 2 relation words: "my elderly MOTHER is being hit"
  for (let n = 0; n < 2 && k < t.length; n++) {
    const r = t[k].raw;
    if (PASSIVE_AUX.has(r) || PASSIVE_PARTICIPLES.has(r) || t[k].brk) break;
    k++;
  }
  while (k < t.length && k <= i + 6 && PASSIVE_AUX.has(t[k].raw)) {
    aux = true;
    k++;
  }
  if (!PASSIVE_PARTICIPLES.has(t[k]?.raw ?? '')) return null;
  if (aux) return k;
  const next = [t[k + 1]?.raw, t[k + 2]?.raw, t[k + 3]?.raw];
  return next[0] === 'in' && next.slice(1).some((r) => IN_SERVICE.has(r ?? ''))
    ? k
    : null;
}

/** Violence words excused for the mention at i: inside service phrases or the passive victim participle. */
function excusedFor(t: Tok[], i: number, spans: Span[]): Set<number> {
  const out = new Set<number>();
  for (const sp of spans) for (let k = sp.s; k < sp.e; k++) out.add(k);
  const v = passiveVictim(t, i);
  if (v !== null) out.add(v);
  return out;
}

/**
 * Shape guard for the possessive pattern: after the mention, "me" or "my
 * money" means the person acts on the searcher ("my elderly dad shoves me",
 * "my elderly father controls my money"). Not after a need or help verb:
 * "my elderly mother needs me to find food".
 */
const ASKING = set(
  'need needs want wants ask asks asked require requires help helps tell show give let',
);
const MY_THINGS = set(
  'money phone car check checks card cards keys paycheck property mail ' +
    'wallet id passport benefits',
);
function actsOnSearcher(t: Tok[], i: number): boolean {
  for (let k = i + 1; k < t.length && k <= i + 6; k++) {
    if (t[k].raw === 'me' && !ASKING.has(t[k - 1]?.raw ?? '')) return true;
    if (t[k].raw === 'my' && MY_THINGS.has(t[k + 1]?.raw ?? '')) return true;
  }
  return false;
}
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
  /** Token indices of violence words excused for the current mention. */
  excused: ReadonlySet<number>;
  /** Abuse-service phrase spans of the query. */
  spans: Span[];
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
  return !(singular && hasViolence(t, c, end, end + 3));
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

const AUX = set('can do does will should could may');
const WH = set('where how what who when which');
const Q_VERBS = set(
  'get find apply stay qualify access receive use sleep eat go',
);
const TAKE_VERBS = set(
  'take takes accept accepts allow allows house houses serve serves admit admits welcome',
);
const NEED_WORDS = set('needs need living lives looking wants struggling');

/** 7. QUESTION: "where can seniors get free meals", "do shelters take men". */
function questionForm(t: Tok[], i: number, c: Context): boolean {
  if (hasViolence(t, c)) return false;
  let k = i - 1;
  while (
    k >= 0 &&
    i - k <= 3 &&
    (FILLERS.has(t[k].raw) || c.all.has(t[k].norm))
  )
    k--;
  if (
    k >= 0 &&
    AUX.has(t[k].raw) &&
    (k === 0 || WH.has(t[k - 1].raw)) &&
    Q_VERBS.has(t[i + 1]?.raw ?? '')
  ) {
    return true;
  }
  return (
    TAKE_VERBS.has(t[i - 1]?.raw ?? '') &&
    isServiceNoun(t[i - 2]?.raw ?? '') &&
    [t[i - 3]?.raw, t[i - 4]?.raw].some((r) => AUX.has(r ?? ''))
  );
}

/** 8. CARE STATEMENT: "my mom is elderly and needs meals", "my husband is a veteran and needs a job". */
function careStatement(t: Tok[], i: number): boolean {
  let k = i - 1;
  while (
    k >= 0 &&
    i - k <= 3 &&
    (ARTICLES.has(t[k].raw) || FILLERS.has(t[k].raw))
  )
    k--;
  if (k < 2 || !['is', 'was'].includes(t[k].raw)) return false;
  if (!POSSESSIVES.has(t[k - 2].raw) && !POSSESSIVES.has(t[k - 3]?.raw ?? ''))
    return false;
  for (let n = i + 1; n < t.length && n <= i + 3; n++) {
    if (NEED_WORDS.has(t[n].raw)) return true;
  }
  return false;
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

/**
 * 9. ABUSE SERVICE: the mention sits in, or right before or after, an abuse
 * service phrase: "women fleeing domestic violence", "teen dating violence
 * hotline". Sex and gender codes need the phrase right next to the mention
 * (no word between); others allow 2 words. Not when an un-excused violence
 * word is in the query.
 */
function serviceUse(t: Tok[], i: number, c: Context): boolean {
  if (hasViolence(t, c)) return false;
  const gap = c.actorProne ? 0 : 2;
  return c.spans.some((sp) => {
    if (i >= sp.s && i < sp.e) return true;
    if (sp.s > i)
      return sp.s - i - 1 <= gap && !t.slice(i, sp.s).some((x) => x.brk);
    return i - sp.e <= gap && !t.slice(sp.e - 1, i).some((x) => x.brk);
  });
}

function isRequest(t: Tok[], i: number, c: Context): boolean {
  return (
    afterFor(t, i, c) ||
    serviceRun(t, i, c) ||
    (!c.actorProne && (t[i + 1]?.raw === 'only' || t[i - 1]?.raw === 'only')) ||
    selfDescribed(t, i) ||
    womenAndChildren(t, i) ||
    questionForm(t, i, c) ||
    serviceUse(t, i, c) ||
    (!c.actorProne &&
      passiveVictim(t, i) !== null &&
      !hasViolence(t, c) &&
      !actsOnSearcher(t, i)) ||
    (!c.actorProne &&
      !hasViolence(t, c) &&
      !actsOnSearcher(t, i) &&
      ((POSSESSIVES.has(t[i - 1]?.raw ?? '') && !COMPARATIVES.has(t[i].norm)) ||
        careStatement(t, i)))
  );
}

const VET_NOUN_NEXT = set(
  'tech technician assistant clinic office hospital student school nurse practice',
);

/**
 * "vet" means veterinarian everywhere except in a self-description ("im a
 * vet", "as a vet", "being a vet"): only there it names the Veterans group.
 */
function isSelfVet(
  t: Tok[],
  i: number,
  words: ReadonlySet<string>,
  c: Context,
): boolean {
  return (
    words.has('veteran') &&
    !VET_NOUN_NEXT.has(t[i + 1]?.raw ?? '') &&
    selfFillers(t, i) &&
    !isNegated(t, i, c)
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
  const spans = phraseSpans(t);
  return t.some((tok, i) => {
    const c: Context = {
      all,
      actorProne,
      spans,
      excused: excusedFor(t, i, spans),
    };
    if (tok.raw === 'vet') return isSelfVet(t, i, words, c);
    return words.has(tok.norm) && isRequest(t, i, c) && !isNegated(t, i, c);
  });
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

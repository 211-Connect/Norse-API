export const DICTIONARY_VERSION = 'dict-2026-11-11.1';

const WA211 =
  'WA211 search terms; code = majority gold label in v2-search--needs r4/train.jsonl';
const LUCAS = 'Lucas 2026-11-11 (suicide/self-harm seed)';

interface Entry {
  re: RegExp;
  code: string;
  source: string;
}

// Tested against normalized text (lowercase, a-z 0-9 and single spaces).
const ENTRIES: Entry[] = [
  { re: /\bsection (8|eight|viii)\b/, code: 'N-HOU-04', source: WA211 },
  { re: /\bhud\b/, code: 'N-HOU-04', source: WA211 },
  { re: /\bdial a ride\b/, code: 'N-TRN-01', source: WA211 },
  { re: /\bparatransit\b/, code: 'N-TRN-01', source: WA211 },
  { re: /\bmeals on wheels\b/, code: 'N-FOD-04', source: WA211 },
  { re: /\bworksource\b/, code: 'N-WRK-01', source: WA211 },
  { re: /\bliheap\b/, code: 'N-HOU-05', source: WA211 },
  { re: /\bsnap\b(?! (in|on)\b)/, code: 'N-FOD-02', source: WA211 },
  { re: /\bebt\b/, code: 'N-FOD-02', source: WA211 },
  { re: /\bwic\b/, code: 'N-FOD-02', source: WA211 },
  { re: /\bfood stamps?\b/, code: 'N-FOD-02', source: WA211 },
  { re: /\bsun ?bucks\b/, code: 'N-FOD-02', source: WA211 },
  { re: /\btanf\b/, code: 'N-MON-03', source: WA211 },
  { re: /\bssi\b/, code: 'N-MON-03', source: WA211 },
  { re: /\bssdi\b/, code: 'N-MON-03', source: WA211 },
  { re: /\bapple health\b/, code: 'N-HLT-02', source: WA211 },
  { re: /\bmedicaid\b/, code: 'N-HLT-02', source: WA211 },
  { re: /\bself harm\b/, code: 'N-MHS-01', source: LUCAS },
  { re: /\bcutting myself\b/, code: 'N-MHS-01', source: LUCAS },
];

const SUICIDE_WORDS = ['suicide', 'suicidal'];
const SUICIDE_BLOCKLIST = ['subside', 'subsided', 'subsides'];

function normalize(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

// Optimal string alignment: Levenshtein plus adjacent transposition as 1.
function osa(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[i][j] = i === 0 ? j : 0;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function fuzzySuicide(text: string): boolean {
  return text
    .split(' ')
    .some(
      (t) =>
        t.startsWith('su') &&
        t.length >= 6 &&
        t.length <= 10 &&
        !SUICIDE_BLOCKLIST.includes(t) &&
        SUICIDE_WORDS.some((w) => osa(t, w) <= 2),
    );
}

export function matchDictionary(query: string): string[] {
  const text = normalize(query ?? '');
  if (!text) return [];
  const out: string[] = [];
  const add = (code: string) => {
    if (!out.includes(code)) out.push(code);
  };
  for (const e of ENTRIES) if (e.re.test(text)) add(e.code);
  if (fuzzySuicide(text)) add('N-MHS-01');
  return out;
}

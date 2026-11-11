import { matchDictionary } from './dictionary';
import { decide } from './engine';
import { req, sig } from '../../common/testing/v2-rules-helpers';

describe('matchDictionary phrase entries', () => {
  it.each([
    ['how do i apply for section 8', ['N-HOU-04']],
    ['Section-Eight housing', ['N-HOU-04']],
    ['section viii waitlist', ['N-HOU-04']],
    ['hud low income housing', ['N-HOU-04']],
    ['dial a ride port townsend', ['N-TRN-01']],
    ['paratransit', ['N-TRN-01']],
    ['meals on wheels olympia', ['N-FOD-04']],
    ['worksource wa', ['N-WRK-01']],
    ['liheap application', ['N-HOU-05']],
    ['snap benefits washington', ['N-FOD-02']],
    ['washington ebt', ['N-FOD-02']],
    ['wic office', ['N-FOD-02']],
    ['dshs food stamps application online', ['N-FOD-02']],
    ['sunbucks wa 2026', ['N-FOD-02']],
    ['sun bucks', ['N-FOD-02']],
    ['tanf', ['N-MON-03']],
    ['ssi', ['N-MON-03']],
    ['ssdi appeal', ['N-MON-03']],
    ['washington state apple health', ['N-HLT-02']],
    ['medicaid', ['N-HLT-02']],
    ['self-harm', ['N-MHS-01']],
    ['cutting myself', ['N-MHS-01']],
  ])('%s', (q, codes) => expect(matchDictionary(q)).toEqual(codes));
});

describe('matchDictionary fuzzy suicide', () => {
  it.each([
    'suicide',
    'suicidal',
    'sucide',
    'suiscide',
    'suiced',
    'suicude',
    'suicidio',
    'suuicide',
    'sulcide',
    'i feel suicidal',
    'SUICIDE hotline now',
  ])('%s', (q) => expect(matchDictionary(q)).toEqual(['N-MHS-01']));
});

describe('matchDictionary non-hits', () => {
  it.each([
    'social security office',
    'sicial',
    'subside',
    'suite rental',
    'success',
    'sunrise',
    'snap on tools',
    'how much are snap in dentures',
    'my husband left',
    'section 80',
    'shuddle',
    '',
    '   ',
  ])('%j', (q) => expect(matchDictionary(q)).toEqual([]));
});

describe('matchDictionary combos', () => {
  it('several hits in order', () =>
    expect(matchDictionary('section 8 and food stamps')).toEqual([
      'N-HOU-04',
      'N-FOD-02',
    ]));
  it('unique codes', () =>
    expect(matchDictionary('snap ebt')).toEqual(['N-FOD-02']));
});

describe('dictionary feeds the engine', () => {
  it('a hit becomes a use need with source dictionary', () => {
    const d = decide(
      req(),
      sig({}, { dictionaryNeeds: matchDictionary('section 8 housing') }),
      {},
    );
    expect(d.needs).toContainEqual({
      code: 'N-HOU-04',
      state: 'use',
      source: 'dictionary',
    });
  });
});

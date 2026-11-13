import { Hotline } from './types';

export const RULES_VERSION = 'rules-2026-11-13.3';

export const CUTOFFS = {
  emergency: { popup: 0.662, soft: 0.221 },
  urgency: { drop: 0.8, use: 0.93 }, // score < drop -> drop; drop <= s < use -> ask; s >= use -> use
  needs: { use: 0.97, ask: 0.12 }, // `use` is also the v1 hybrid need boost gate; s >= use -> use; ask <= s < use -> ask; else drop
  area: { tier1Min: 0.9, tier2Max: 0.5 },
  nx: { label: 0.07 },
  start: { modelAreasMin: 0.3 },
  maxQuestions: 3,
  optionsPerQuestion: 3,
};

export const DEFAULT_HOTLINES: Hotline[] = [
  { label: 'Crisis line', number: '988' },
  { label: 'Emergency', number: '911' },
];
export const DEFAULT_TOP_AREAS = ['N-HOU', 'N-FOD', 'N-MON'];

export const STEMS = {
  emergency: 'Are you in danger right now?',
  today: 'Do you need this today?',
  time: 'When do you need this?',
  start: 'What do you need help with most?',
  area: 'Which kind of help with {area}?',
  narrow: 'Which of these fits best?',
  narrowAlso: 'Do any of these also fit?',
};

export const LABELS = {
  urgency: {
    'U-1': 'Today',
    'U-2': 'A deadline is coming',
    'U-3': 'Not urgent',
    'U-4': "I'm planning ahead",
  } as Record<string, string>,
  // Answers to STEMS.emergency, for the red popup and the orange soft card
  // alike (Lucas 2026-11-13, question 24, option B2). Same urgency codes.
  emergency: {
    yes: 'Yes, I am in danger',
    safe: 'No, I am safe now',
  },
};


/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Inputs for the legacy parity proof: every row of the gold set and of the
 * golden scores, each run with two count shapes. Shared by the parity spec and
 * by scripts/v2-legacy-snapshot.ts (which runs them on origin/development's
 * code to write __fixtures__/legacy-snapshot.json). Types are loose on purpose:
 * the same inputs feed two copies of the engine.
 */
export interface SnapshotCase {
  key: string;
  request: Record<string, unknown>;
  signals: Record<string, unknown>;
  counts: { total: number | null; by_code: 'ten' | null };
}

interface GoldRow {
  i: number;
  scores: Record<string, number>;
  nx: number;
  urgency: unknown;
  emergency: Record<string, unknown>;
}
interface GoldenRow {
  query: string;
  needs: Record<string, number>;
  emergency: { score: number; floor_hit: boolean };
}

const REQUEST = {
  has_text: true,
  needs: [],
  passed_needs: [],
  clarify: 'auto',
};

export function snapshotCases(): SnapshotCase[] {
  const gold: { rows: GoldRow[] } = require('../__fixtures__/gold-set.json');
  const golden: {
    rows: GoldenRow[];
  } = require('../__fixtures__/golden-scores.json');
  const signalsList: { key: string; signals: Record<string, unknown> }[] = [
    ...gold.rows.map((r) => ({
      key: `gold:${r.i}`,
      signals: {
        needs: { status: 'ok', scores: { ...r.scores, 'N-X': r.nx } },
        urgency: r.urgency,
        emergency: { status: 'ok', ...r.emergency },
      },
    })),
    ...golden.rows.map((r, k) => ({
      key: `golden:${k}`,
      signals: {
        needs: { status: 'ok', scores: r.needs },
        emergency: { status: 'ok', ...r.emergency },
      },
    })),
  ];
  const out: SnapshotCase[] = [];
  for (const s of signalsList) {
    // The gold-set run: every option count is 10 of 100.
    out.push({
      key: `${s.key}:counted`,
      request: REQUEST,
      signals: s.signals,
      counts: { total: 100, by_code: 'ten' },
    });
    // Nothing counted.
    out.push({
      key: `${s.key}:uncounted`,
      request: REQUEST,
      signals: s.signals,
      counts: { total: null, by_code: null },
    });
  }
  return out;
}

interface Engine {
  decide: (req: never, signals: never, tenant: never) => any;
  finalize: (decision: never, input: never) => any;
}

/** decide + finalize for one case, JSON-normalized (undefined keys dropped). */
export function runCase(engine: Engine, c: SnapshotCase): unknown {
  const decision = engine.decide(
    c.request as never,
    c.signals as never,
    {} as never,
  );
  const by_code: Record<string, number> | null =
    c.counts.by_code === 'ten'
      ? Object.fromEntries(
          (decision.count_codes as string[]).map((x) => [x, 10]),
        )
      : null;
  const clarification = engine.finalize(
    decision as never,
    {
      counts: { total: c.counts.total, by_code },
      strong_text_match: false,
    } as never,
  );
  return JSON.parse(JSON.stringify({ decision, clarification }));
}

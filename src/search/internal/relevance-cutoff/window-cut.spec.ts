import { cutWindow, CUTOFF_WINDOW_RANK_CAP } from './window-cut';

const desc = (n: number, from: number, step: number) =>
  Array.from({ length: n }, (_, i) => from - i * step);

describe('cutWindow', () => {
  it('keeps nothing for an empty window', () => {
    expect(cutWindow([])).toEqual({
      kept: 0,
      cutoffScore: null,
      capped: false,
    });
  });

  it("applies today's rule: 0.2 x top when rank 20 is lower", () => {
    // top 100, ranks 0..29 = 100..71, then 10 hits at 15 (< 20 = 0.2 x top)
    const scores = [...desc(30, 100, 1), ...Array(10).fill(15)];
    // rank 20 score = 80, threshold = min(20, 80) = 20 -> 30 kept
    expect(cutWindow(scores)).toMatchObject({ kept: 30, capped: false });
  });

  it('clamps to the rank-20 score so the top 20 always survive', () => {
    // top 100, all later hits at 5: 0.2 x top = 20 but rank 20 scores 5
    const scores = [100, ...Array(60).fill(5)];
    const cut = cutWindow(scores);
    expect(cut.kept).toBe(61);
    expect(cut.cutoffScore).toBe(5);
  });

  it('caps at the rank cap when the rule keeps more', () => {
    const scores = desc(200, 100, 0.1); // all above 0.2 x top
    expect(cutWindow(scores)).toMatchObject({
      kept: CUTOFF_WINDOW_RANK_CAP,
      capped: true,
    });
  });

  it('keeps ties at the threshold together', () => {
    const scores = [...desc(21, 100, 0), 90, 90, 90, 1];
    // rank 20 = 100; threshold = min(20, 100) = 20; the 1 drops
    expect(cutWindow(scores).kept).toBe(24);
  });

  it('keeps all (to the cap) when the top is not positive', () => {
    expect(cutWindow([0, 0, 0]).kept).toBe(3);
  });

  it('keeps fewer than 20 when the window is small', () => {
    expect(cutWindow([10, 9, 1]).kept).toBe(2);
  });
});

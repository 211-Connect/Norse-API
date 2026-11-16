/**
 * Reciprocal rank fusion (Cormack et al., 2009). Each list votes for an id
 * with 1 / (k + rank), where rank is the 1-based position of the id's first
 * occurrence in that list. The votes add up.
 *
 * Order: score descending. A tie goes to the id with the smaller best rank,
 * then to the id whose best rank sits in the earlier list, then to the id
 * string in ascending order.
 */
const SCORE_EPSILON = 1e-12;

export function reciprocalRankFusion(
  lists: readonly (readonly string[])[],
  k: number,
): string[] {
  const entries = new Map<
    string,
    { score: number; bestRank: number; bestList: number }
  >();

  lists.forEach((list, listIndex) => {
    const seen = new Set<string>();
    list.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const rank = i + 1;
      const entry = entries.get(id);
      if (!entry) {
        entries.set(id, {
          score: 1 / (k + rank),
          bestRank: rank,
          bestList: listIndex,
        });
        return;
      }
      entry.score += 1 / (k + rank);
      // Lists are walked in order, so an equal rank never replaces an
      // earlier list.
      if (rank < entry.bestRank) {
        entry.bestRank = rank;
        entry.bestList = listIndex;
      }
    });
  });

  return [...entries.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
      if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
      if (a.bestList !== b.bestList) return a.bestList - b.bestList;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map(([id]) => id);
}

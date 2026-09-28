import { interiorGrid, pointsAtDepth } from './interior-points';

/** About 1 km on a side at latitude 38.6 (St. Louis). */
const DLAT = 1000 / 110_540;
const DLON = 1000 / (111_320 * Math.cos((38.6 * Math.PI) / 180));
const square = (lon: number, lat: number, scale = 1) => [
  [lon, lat],
  [lon + DLON * scale, lat],
  [lon + DLON * scale, lat + DLAT * scale],
  [lon, lat + DLAT * scale],
  [lon, lat],
];

describe('interiorGrid', () => {
  it('keeps points inside and measures their depth in metres', () => {
    const grid = interiorGrid(
      { type: 'Polygon', coordinates: [square(-90.3, 38.6)] },
      400,
    );
    expect(grid.spacingM).toBeCloseTo(50, 0);
    expect(grid.points).toHaveLength(400);
    const deepest = Math.max(...grid.points.map((p) => p.depth));
    expect(deepest).toBeGreaterThan(470);
    expect(deepest).toBeLessThanOrEqual(500);
    expect(Math.min(...grid.points.map((p) => p.depth))).toBeCloseTo(25, 0);
  });

  it('drops points in a hole and measures depth to the hole edge', () => {
    const outer = square(-90.3, 38.6, 3);
    const hole = square(-90.3 + DLON, 38.6 + DLAT, 1);
    const grid = interiorGrid(
      { type: 'Polygon', coordinates: [outer, hole] },
      900,
    );
    // 9 km² less the 1 km² hole.
    expect(grid.points.length).toBeGreaterThan(780);
    expect(grid.points.length).toBeLessThan(820);
    // Deepest where the outer edge and a hole corner are equidistant, about
    // 586 m on the diagonal. Without the hole it would be 1,500 m.
    const deepest = Math.max(...grid.points.map((p) => p.depth));
    expect(deepest).toBeGreaterThan(540);
    expect(deepest).toBeLessThan(590);
  });

  it('handles MultiPolygons and thins by depth', () => {
    const grid = interiorGrid(
      {
        type: 'MultiPolygon',
        coordinates: [[square(-90.3, 38.6)], [square(-90.28, 38.6)]],
      },
      2000,
    );
    expect(pointsAtDepth(grid, 0).length).toBe(grid.points.length);
    expect(pointsAtDepth(grid, 400).length).toBeLessThan(
      grid.points.length / 10,
    );
    expect(pointsAtDepth(grid, 0, 50).length).toBeLessThanOrEqual(50);
    expect(pointsAtDepth(grid, 600)).toEqual([]);
  });
});

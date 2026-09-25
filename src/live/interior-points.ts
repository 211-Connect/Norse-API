/**
 * Grid points inside a GeoJSON Polygon or MultiPolygon, each with its distance
 * to the boundary. The live geography suite uses them to tell a service area
 * that overlaps a Region's interior from one that only touches its edge or
 * overlaps it by a sliver: a geo_shape `intersects` counts both.
 *
 * Distances use a local equirectangular projection around the shape's bbox
 * centre, which is accurate to well under 1% at county scale.
 */

type Position = [number, number];
type Ring = Position[];

export interface InteriorPoint {
  lon: number;
  lat: number;
  /** Metres to the nearest boundary edge, holes included. */
  depth: number;
}

export interface InteriorGrid {
  spacingM: number;
  points: InteriorPoint[];
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQUATOR = 111_320;

export function ringsOf(geometry: {
  type: string;
  coordinates: unknown;
}): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as Ring[][]).flat();
  }
  throw new Error(`Unsupported geometry type ${geometry.type}`);
}

/** Even-odd rule over every ring: holes and disjoint parts both work. */
function inside(x: number, y: number, rings: Ring[]): boolean {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        odd = !odd;
      }
    }
  }
  return odd;
}

function distanceToRings(x: number, y: number, rings: Ring[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

/** A square grid over the bbox with about `cells` cells, kept where inside. */
export function interiorGrid(
  geometry: { type: string; coordinates: unknown },
  cells = 6000,
): InteriorGrid {
  const rings = ringsOf(geometry);
  const all = rings.flat();
  const lons = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const lat0 = (minLat + maxLat) / 2;
  const mPerLon = M_PER_DEG_LON_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lon, lat]: Position): Position => [
    (lon - minLon) * mPerLon,
    (lat - minLat) * M_PER_DEG_LAT,
  ];
  const projected = rings.map((ring) => ring.map(toXY));
  const width = (maxLon - minLon) * mPerLon;
  const height = (maxLat - minLat) * M_PER_DEG_LAT;
  const spacingM = Math.sqrt((width * height) / cells);

  const points: InteriorPoint[] = [];
  for (let y = spacingM / 2; y < height; y += spacingM) {
    for (let x = spacingM / 2; x < width; x += spacingM) {
      if (!inside(x, y, projected)) continue;
      points.push({
        lon: minLon + x / mPerLon,
        lat: minLat + y / M_PER_DEG_LAT,
        depth: distanceToRings(x, y, projected),
      });
    }
  }
  return { spacingM, points };
}

/** Points at least `minDepth` metres inside, evenly thinned to at most `cap`. */
export function pointsAtDepth(
  grid: InteriorGrid,
  minDepth: number,
  cap = 1500,
): Position[] {
  const deep = grid.points.filter((p) => p.depth >= minDepth);
  const step = Math.max(1, Math.ceil(deep.length / cap));
  return deep.filter((_, i) => i % step === 0).map((p) => [p.lon, p.lat]);
}

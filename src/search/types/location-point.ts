export type LocationPointInput =
  | { lat: number; lon: number }
  | { coordinates: [number, number] }
  | [number, number]
  | string
  | null
  | undefined;

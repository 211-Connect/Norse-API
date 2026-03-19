export type LocationPointInput =
  | { lat: number; lon: number }
  | [number, number]
  | string
  | null
  | undefined;

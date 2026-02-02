import { z } from 'zod';

const positionSchema = z.number().array().min(2);

const pointSchema = z.object({
  type: z.literal('Point'),
  coordinates: positionSchema,
});

const multiPointSchema = z.object({
  type: z.literal('MultiPoint'),
  coordinates: z.array(positionSchema),
});

const lineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(positionSchema),
});

const multiLineStringSchema = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(positionSchema)),
});

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(positionSchema)),
});

const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(positionSchema))),
});

const geometrySchema = z.union([
  pointSchema,
  multiPointSchema,
  lineStringSchema,
  multiLineStringSchema,
  polygonSchema,
  multiPolygonSchema,
]);

export const searchBodySchema = z.object({
  geometry: geometrySchema.optional(),
});

export type SearchBodyDto = z.infer<typeof searchBodySchema>;

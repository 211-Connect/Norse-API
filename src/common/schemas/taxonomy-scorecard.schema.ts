import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TaxonomyScorecardDocument = HydratedDocument<TaxonomyScorecard>;

@Schema({ _id: false })
export class ScorecardNeed {
  @Prop({ type: Object, default: {} })
  weights: Record<string, number>;

  @Prop({ type: String, default: null })
  top_category_code: string | null;

  @Prop({ type: Number, default: null })
  top_weight: number | null;

  @Prop({ type: [String], default: [] })
  need_categories_present: string[];
}

@Schema({ _id: false })
export class TaxonomyScorecardPayload {
  @Prop({ type: ScorecardNeed, default: {} })
  need: ScorecardNeed;

  @Prop({ type: Object, default: null })
  target_population?: unknown | null;

  @Prop({ type: Object, default: null })
  urgency?: unknown | null;
}

@Schema({ _id: false })
export class TaxonomySource {
  @Prop({ required: true })
  owner: string;

  @Prop({ type: String, default: null })
  customization_version: string | null;

  @Prop({ required: true, default: true })
  isProduction: boolean;

  @Prop({ required: true })
  published_at: string;
}

@Schema({ _id: false })
export class ScorecardVersionEntry {
  @Prop({ type: Object, required: true })
  scorecard: TaxonomyScorecardPayload;

  @Prop({ type: Object, required: true })
  source: TaxonomySource;

  @Prop({ required: true })
  created_at: string;
}

@Schema({ _id: false })
export class VersionMetadata {
  @Prop({ required: true, default: 0 })
  next_version: number;

  @Prop({ type: Number, default: null })
  active_version?: number | null;

  @Prop({ type: String, default: 'update', enum: ['update', 'enable'] })
  last_action?: 'update' | 'enable';
}

@Schema({ timestamps: false, collection: 'taxonomy_scorecard' })
export class TaxonomyScorecard {
  @Prop({ required: true })
  _id: string;

  @Prop({ required: true, index: true })
  hsis_code: string;

  @Prop({ required: true })
  hsis_name: string;

  @Prop({ type: String, default: null })
  scorecard_version?: string | null;

  @Prop({ type: String, default: null })
  taxonomy_version?: string | null;

  @Prop({ type: TaxonomyScorecardPayload, required: true })
  scorecard: TaxonomyScorecardPayload;

  @Prop({ type: [String], default: [] })
  components_available: string[];

  @Prop({ type: TaxonomySource, required: true })
  source: TaxonomySource;

  @Prop({ type: Object, default: {} })
  versions?: Record<string, ScorecardVersionEntry>;

  @Prop({ type: VersionMetadata, default: undefined })
  version_metadata?: VersionMetadata;

  @Prop({ required: true })
  updated_at: string;
}

export const TaxonomyScorecardSchema =
  SchemaFactory.createForClass(TaxonomyScorecard);

TaxonomyScorecardSchema.index(
  { hsis_code: 1, 'source.owner': 1 },
  { unique: true, name: 'uniq_hsis_code_owner' },
);
TaxonomyScorecardSchema.index(
  { 'source.owner': 1 },
  { name: 'idx_source_owner' },
);
TaxonomyScorecardSchema.index(
  { 'source.owner': 1, 'source.isProduction': 1 },
  { name: 'idx_source_owner_production' },
);
TaxonomyScorecardSchema.index(
  { 'scorecard.need.top_category_code': 1 },
  { name: 'idx_need_top_category' },
);
TaxonomyScorecardSchema.index(
  { 'scorecard.need.need_categories_present': 1 },
  { name: 'idx_need_categories_present' },
);

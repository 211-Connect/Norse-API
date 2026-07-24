import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PrintableDirectoryDocument = HydratedDocument<PrintableDirectory>;

export const PRINTABLE_DIRECTORY_COVER_LAYOUTS = ['default'] as const;
export type PrintableDirectoryCoverLayout =
  (typeof PRINTABLE_DIRECTORY_COVER_LAYOUTS)[number];

export const PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS = [
  'line',
  'summary',
  'full',
  'custom-search',
  'custom-resource',
] as const;
export type PrintableDirectoryResourceLayout =
  (typeof PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS)[number];

export const PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS = [
  'text',
  'logo',
  'domain',
  'date',
] as const;
export type PrintableDirectoryHeaderFooterLayoutItem =
  (typeof PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS)[number];

export const PRINTABLE_DIRECTORY_SOURCE_TYPES = [
  'query',
  'favorites_list',
  'resource_ids',
] as const;
export type PrintableDirectorySourceType =
  (typeof PRINTABLE_DIRECTORY_SOURCE_TYPES)[number];

export const PRINTABLE_DIRECTORY_ACCESS_POLICIES = [
  'private',
  'shared-read',
  'shared-edit',
] as const;
export type PrintableDirectoryAccessPolicy =
  (typeof PRINTABLE_DIRECTORY_ACCESS_POLICIES)[number];

@Schema({ _id: false })
export class PrintableDirectoryLocalizedText {
  @Prop({ type: Object, default: {} })
  values: Record<string, string>;
}

@Schema({ _id: false })
export class PrintableDirectoryCover {
  @Prop({ type: PrintableDirectoryLocalizedText, default: {} })
  titleLocalized?: PrintableDirectoryLocalizedText;

  @Prop({ type: PrintableDirectoryLocalizedText, default: {} })
  descriptionLocalized?: PrintableDirectoryLocalizedText;

  @Prop({ type: String, default: null })
  primaryColor?: string | null;

  @Prop({
    type: String,
    enum: PRINTABLE_DIRECTORY_COVER_LAYOUTS,
    default: 'default',
  })
  layoutType?: PrintableDirectoryCoverLayout;

  @Prop({ type: String, default: null })
  coverImageUrlFront?: string | null;

  @Prop({ type: String, default: null })
  coverImageUrlBack?: string | null;
}

@Schema({ _id: false })
export class PrintableDirectoryHeaderFooter {
  @Prop({
    type: [String],
    enum: PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS,
    default: [],
  })
  layout: PrintableDirectoryHeaderFooterLayoutItem[];

  @Prop({ type: PrintableDirectoryLocalizedText, default: {} })
  textLocalized?: PrintableDirectoryLocalizedText;

  @Prop({ type: String, default: null })
  logoUrl?: string | null;
}

@Schema({ _id: false })
export class PrintableDirectorySectionSourceQuery {
  @Prop({ type: String, default: null })
  title?: string | null;

  @Prop({ type: Object, default: {} })
  params: Record<string, unknown>;

  @Prop({ type: Object, default: null })
  body?: Record<string, unknown> | null;
}

@Schema({ _id: false })
export class PrintableDirectoryCoords {
  @Prop({ required: true, type: Number })
  latitude: number;

  @Prop({ required: true, type: Number })
  longitude: number;
}

@Schema({ _id: false })
export class PrintableDirectoryDefaultQueryConfig {
  @Prop({ type: String, default: null })
  locationName?: string | null;

  @Prop({ type: PrintableDirectoryCoords, default: null })
  coords?: PrintableDirectoryCoords | null;

  @Prop({ type: Number, default: null })
  radius?: number | null;
}

@Schema({ _id: false })
export class PrintableDirectorySectionSource {
  @Prop({ required: true, type: String })
  id: string;

  @Prop({ required: true, type: Number })
  order: number;

  @Prop({
    required: true,
    enum: PRINTABLE_DIRECTORY_SOURCE_TYPES,
    type: String,
  })
  type: PrintableDirectorySourceType;

  @Prop({ type: PrintableDirectorySectionSourceQuery, default: null })
  query?: PrintableDirectorySectionSourceQuery | null;

  @Prop({ type: String, default: null })
  favoritesListId?: string | null;

  @Prop({ type: [String], default: undefined })
  resourceIds?: string[];
}

@Schema({ _id: false })
export class PrintableDirectorySection {
  @Prop({ required: true, type: String })
  id: string;

  @Prop({ required: true, type: Number })
  order: number;

  @Prop({ type: PrintableDirectoryLocalizedText, default: {} })
  headingLocalized: PrintableDirectoryLocalizedText;

  @Prop({ type: PrintableDirectoryLocalizedText, default: {} })
  descriptionLocalized: PrintableDirectoryLocalizedText;

  @Prop({ type: Number, default: 100 })
  maxResources: number;

  @Prop({ type: [PrintableDirectorySectionSource], default: [] })
  sources: PrintableDirectorySectionSource[];
}

@Schema({ timestamps: true, collection: 'printableDirectories' })
export class PrintableDirectory {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true, index: true })
  ownerUserId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  updatedBy?: string | null;

  @Prop({
    required: true,
    enum: PRINTABLE_DIRECTORY_ACCESS_POLICIES,
    type: String,
    default: 'private',
  })
  accessPolicy: PrintableDirectoryAccessPolicy;

  @Prop({ type: PrintableDirectoryCover, default: {} })
  cover: PrintableDirectoryCover;

  @Prop({
    type: PrintableDirectoryHeaderFooter,
    default: { layout: [] },
  })
  header: PrintableDirectoryHeaderFooter;

  @Prop({
    type: PrintableDirectoryHeaderFooter,
    default: { layout: [] },
  })
  footer: PrintableDirectoryHeaderFooter;

  @Prop({
    required: true,
    enum: PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS,
    type: String,
    default: 'line',
  })
  resourceLayout: PrintableDirectoryResourceLayout;

  @Prop({ type: Boolean, default: false })
  isBookletLayout: boolean;

  @Prop({ type: PrintableDirectoryDefaultQueryConfig, default: null })
  defaultQueryConfig?: PrintableDirectoryDefaultQueryConfig | null;

  @Prop({ type: [PrintableDirectorySection], default: [] })
  sections: PrintableDirectorySection[];

  @Prop({ type: Date, default: null })
  createdAt?: Date;

  @Prop({ type: Date, default: null })
  updatedAt?: Date;
}

export const PrintableDirectorySchema =
  SchemaFactory.createForClass(PrintableDirectory);

PrintableDirectorySchema.index({ tenantId: 1, ownerUserId: 1, updatedAt: -1 });
PrintableDirectorySchema.index({ tenantId: 1, ownerUserId: 1, name: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * ServiceNet's projection of its Withholdings (ServiceNet ADR 0022), written
 * by ServiceNet and only read here. ServiceNet owns the indexes, so neither
 * collection is created or indexed from this side.
 */

/** One withheld service of one Withholding, visible at versions [version, liftedVersion). */
@Schema({
  collection: 'sharing_withheld_services',
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
})
export class SharingWithheldService {
  @Prop() _id: string;
  @Prop() agreementId: string;
  @Prop() ownerWriterId: string;
  @Prop() serviceId: string;
  @Prop() version: number;
  @Prop({ type: Number, default: null }) liftedVersion: number | null;
}

export const SharingWithheldServiceSchema = SchemaFactory.createForClass(
  SharingWithheldService,
);

/** The version of one Withholding the projection holds, and how many services it withholds. */
@Schema({
  collection: 'sharing_withheld_versions',
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
})
export class SharingWithheldVersion {
  @Prop() _id: string;
  @Prop() agreementId: string;
  @Prop() ownerWriterId: string;
  @Prop() version: number;
  @Prop() serviceCount: number;
}

export const SharingWithheldVersionSchema = SchemaFactory.createForClass(
  SharingWithheldVersion,
);

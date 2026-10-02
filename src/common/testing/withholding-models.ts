import { getModelToken } from '@nestjs/mongoose';
import {
  SharingWithheldService,
  SharingWithheldVersion,
} from 'src/common/schemas/sharing-withholding.schema';

const refuse = () => {
  throw new Error('This suite sends no Withholdings; MongoDB is not wired');
};

/**
 * Model stubs for a suite that mounts the internal services routes without
 * MongoDB: nothing may read a Withholding through them.
 */
export const UNWIRED_WITHHOLDING_MODELS = [
  {
    token: getModelToken(SharingWithheldService.name),
    value: { find: refuse },
  },
  {
    token: getModelToken(SharingWithheldVersion.name),
    value: { findOne: refuse },
  },
];

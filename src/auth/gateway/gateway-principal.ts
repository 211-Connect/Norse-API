import { SetMetadata } from '@nestjs/common';

export const GATEWAY_EXTERNAL_ID_HEADER = 'x-connect211-identity-external-id';
export const GATEWAY_KEY_ID_HEADER = 'x-connect211-key-id';

export const GATEWAY_EXTERNAL_ID_MAX_LENGTH = 256;
export const GATEWAY_KEY_ID_MAX_LENGTH = 128;

export interface GatewayPrincipal {
  externalId: string;
  keyId: string;
}

export const PUBLIC_KEY = Symbol('PUBLIC_KEY');
export const Public = () => SetMetadata(PUBLIC_KEY, true);

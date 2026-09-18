import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

function parseUuid(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const result = uuidSchema.safeParse(trimmed);
  return result.success ? result.data : null;
}

export function resolveTargetTenant(req: Request): string | undefined {
  const headerRaw = req.get('x-tenant-id');
  const headerValue =
    typeof headerRaw === 'string' && headerRaw.trim() ? headerRaw : undefined;

  let fromHeader: string | undefined;
  if (headerValue !== undefined) {
    fromHeader = parseUuid(headerValue);
    if (fromHeader === null) {
      throw new BadRequestException('tenant_target_invalid');
    }
  }

  let fromMiddleware: string | undefined;
  if (req.tenantId) {
    fromMiddleware = parseUuid(req.tenantId);
    if (fromMiddleware === null) {
      throw new BadRequestException('tenant_target_invalid');
    }
  }

  if (fromHeader !== undefined && fromMiddleware !== undefined) {
    if (fromHeader !== fromMiddleware) {
      throw new BadRequestException('tenant_target_mismatch');
    }
    return fromHeader;
  }

  return fromHeader ?? fromMiddleware;
}

export type RequiredVerb = 'read' | 'write';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiredVerb(method: string): RequiredVerb {
  return READ_METHODS.has(method.toUpperCase()) ? 'read' : 'write';
}

export function requiredSlug(target: string, method: string): string {
  return `norse-api.${target}.${requiredVerb(method)}`;
}

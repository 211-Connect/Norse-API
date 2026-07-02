import {
  ScorecardNeed,
  ScorecardVersionEntry,
  TaxonomyScorecard,
  TaxonomyScorecardPayload,
  TaxonomySource,
  VersionMetadata,
} from 'src/common/schemas/taxonomy-scorecard.schema';

export const DEFAULT_SCORECARD_OWNER = 'default';

export function buildDocumentId(hsisCode: string, owner: string): string {
  return `${hsisCode}::${owner}`;
}

export function normalizeWeights(
  weights: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(weights)
      .filter(
        ([key, value]) =>
          key.trim().length > 0 && Number.isFinite(value) && value !== 0,
      )
      .map(([key, value]) => [key.trim(), value]),
  );
}

export function deriveNeedMetadata(
  weights: Record<string, number>,
): ScorecardNeed {
  const normalizedWeights = normalizeWeights(weights);
  const entries = Object.entries(normalizedWeights);

  if (entries.length === 0) {
    return {
      weights: {},
      top_category_code: null,
      top_weight: null,
      need_categories_present: [],
    };
  }

  const [topCategoryCode, topWeight] = entries.reduce((best, current) =>
    current[1] > best[1] ? current : best,
  );

  return {
    weights: normalizedWeights,
    top_category_code: topCategoryCode,
    top_weight: topWeight,
    need_categories_present: Object.keys(normalizedWeights),
  };
}

export function isChildOrSelfCode(
  parentCode: string,
  candidateCode: string,
): boolean {
  return isTaxonomyDescendantOrSelf(parentCode, candidateCode);
}

export function getTaxonomyAncestors(code: string): string[] {
  const normalized = code.trim();

  if (!normalized) {
    return [];
  }

  if (!normalized.includes('-')) {
    if (normalized.length === 1) {
      return [normalized];
    }

    return Array.from({ length: normalized.length }, (_, index) =>
      normalized.slice(0, index + 1),
    );
  }

  const [prefix, ...rest] = normalized.split('-');
  const ancestors: string[] = [];

  if (prefix.length === 1) {
    ancestors.push(prefix);
  } else {
    for (let index = 0; index < prefix.length; index += 1) {
      ancestors.push(prefix.slice(0, index + 1));
    }
  }

  let previousLevel = prefix;
  for (const segment of rest) {
    const dotParts = segment.split('.');

    for (let index = 0; index < dotParts.length; index += 1) {
      const partialSegment = dotParts.slice(0, index + 1).join('.');
      if (index === 0) {
        previousLevel = `${previousLevel}-${partialSegment}`;
      } else {
        previousLevel = `${previousLevel}.${dotParts[index]}`;
      }

      ancestors.push(previousLevel);
    }
  }

  return ancestors;
}

export function getTaxonomyParentCode(code: string): string | null {
  const ancestors = getTaxonomyAncestors(code);

  if (ancestors.length <= 1) {
    return null;
  }

  return ancestors[ancestors.length - 2];
}

export function isTaxonomyDescendantOrSelf(
  parentCode: string,
  candidateCode: string,
): boolean {
  const parentAncestors = getTaxonomyAncestors(parentCode);
  const candidateAncestors = getTaxonomyAncestors(candidateCode);

  if (parentAncestors.length === 0 || candidateAncestors.length === 0) {
    return false;
  }

  const parentSelf = parentAncestors[parentAncestors.length - 1];
  const candidateSelf = candidateAncestors[candidateAncestors.length - 1];

  if (candidateSelf === parentSelf) {
    return true;
  }

  if (candidateAncestors.length < parentAncestors.length) {
    return false;
  }

  return parentAncestors.every(
    (value, index) => candidateAncestors[index] === value,
  );
}

export function isDirectTaxonomySibling(
  selectedCode: string,
  candidateCode: string,
): boolean {
  const selectedAncestors = getTaxonomyAncestors(selectedCode);
  const candidateAncestors = getTaxonomyAncestors(candidateCode);

  if (selectedAncestors.length === 0 || candidateAncestors.length === 0) {
    return false;
  }

  const selectedParent = getTaxonomyParentCode(selectedCode);
  const candidateParent = getTaxonomyParentCode(candidateCode);

  return (
    selectedAncestors.length === candidateAncestors.length &&
    selectedParent !== null &&
    candidateParent === selectedParent
  );
}

export function getTaxonomyChildPrefix(code: string): string {
  if (!code.includes('-')) {
    return `${code}-`;
  }

  const lastHyphen = code.lastIndexOf('-');
  const lastDot = code.lastIndexOf('.');

  if (lastDot > lastHyphen) {
    return `${code}-`;
  }

  return `${code}.`;
}

export function getNextVersionId(
  versions?: Record<string, ScorecardVersionEntry>,
  versionMetadata?: VersionMetadata,
): number {
  if (versionMetadata && Number.isInteger(versionMetadata.next_version)) {
    return versionMetadata.next_version;
  }

  if (!versions || Object.keys(versions).length === 0) {
    return 0;
  }

  const maxVersion = Object.keys(versions)
    .map((key) => Number.parseInt(key, 10))
    .filter((value) => Number.isInteger(value))
    .reduce((max, current) => Math.max(max, current), -1);

  return maxVersion + 1;
}

export function cloneScorecardPayload(
  payload?: TaxonomyScorecardPayload | null,
): TaxonomyScorecardPayload {
  return {
    need: {
      weights: { ...(payload?.need?.weights ?? {}) },
      top_category_code: payload?.need?.top_category_code ?? null,
      top_weight: payload?.need?.top_weight ?? null,
      need_categories_present: [
        ...(payload?.need?.need_categories_present ?? []),
      ],
    },
    target_population: payload?.target_population ?? null,
    urgency: payload?.urgency ?? null,
  };
}

export function cloneSource(source?: TaxonomySource | null): TaxonomySource {
  return {
    owner: source?.owner ?? DEFAULT_SCORECARD_OWNER,
    customization_version: source?.customization_version ?? null,
    isProduction: source?.isProduction ?? true,
    published_at: source?.published_at ?? new Date().toISOString(),
  };
}

export function createVersionEntry(args: {
  document: TaxonomyScorecard;
  nowIso: string;
  scorecard?: TaxonomyScorecardPayload;
  source?: TaxonomySource;
  createdByEmail?: string | null;
}): ScorecardVersionEntry {
  return {
    scorecard: cloneScorecardPayload(args.scorecard ?? args.document.scorecard),
    source: cloneSource(args.source ?? args.document.source),
    created_at: args.nowIso,
    created_by_email: args.createdByEmail ?? null,
  };
}

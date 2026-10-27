/**
 * One-time rewrite of saved service-at-location ids after a tenant is
 * re-keyed (ISS-2516), run at cutover (ISS-2519) by
 * `scripts/rewrite-saved-ids.ts`. Given one tenant and an old -> new id
 * mapping, it replaces old ids with new ones in that tenant's stored
 * favorite lists (`favoriteLists.favorites`) and printable-directory
 * `resource_ids` sources (`printableDirectories.sections[].sources[].resourceIds`).
 *
 * - Tenant-scoped: every read and every write filters on `tenantId`. A
 *   document with no tenant is never touched; the report counts the ones
 *   that hold a mapped id so a human can decide about them.
 * - Idempotent: the mapping may not chain (no new id is also an old id), so
 *   after one run no mapped old id remains, and a second run writes nothing.
 * - A write is conditional on `updatedAt` being what was read, so a document
 *   saved in between is skipped and counted, not overwritten. `updatedAt` is
 *   not bumped: the rewrite does not reorder anyone's "recently edited".
 * - `dryRun` computes the same report and writes nothing.
 *
 * Organization ids in query sources (`params.organization_id`) are not
 * rewritten here; see ISS-2517.
 */

export class RekeyMappingError extends Error {}

interface Cursor<T> {
  toArray(): Promise<T[]>;
}

/** The subset of a MongoDB driver `Collection` the rewrite uses. */
export interface RewriteCollection {
  find(filter: object, options?: object): Cursor<any>;
  countDocuments(filter: object): Promise<number>;
  updateOne(
    filter: object,
    update: object,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
}

export interface RewriteCollections {
  favoriteLists: RewriteCollection;
  printableDirectories: RewriteCollection;
  redirects: RewriteCollection;
}

export interface RewriteOptions {
  tenantId: string;
  mapping: Map<string, string>;
  dryRun: boolean;
}

export interface CollectionReport {
  /** Documents of this tenant holding at least one mapped old id. */
  matched: number;
  /** Documents rewritten (or, in a dry run, that would be). */
  changed: number;
  /** Old ids replaced across those documents. */
  idsReplaced: number;
  /** Changed between read and write, so left alone. Always 0 in a dry run. */
  skipped: number;
}

export interface RewriteReport {
  tenantId: string;
  dryRun: boolean;
  mapping: { entries: number; withoutRedirectRow: number };
  favoriteLists: CollectionReport;
  printableDirectories: CollectionReport;
  /** Documents with no tenantId that hold a mapped old id. Never touched. */
  tenantless: { favoriteLists: number; printableDirectories: number };
}

const DIRECTORY_IDS_PATH = 'sections.sources.resourceIds';
const NO_TENANT = { $in: [null, ''] };

/** Parses `[{oldId,newId}]` JSON, or CSV with an `old_id,new_id` header. */
export function parseMapping(text: string, name: string): Map<string, string> {
  let pairs: [string, string][];
  if (name.toLowerCase().endsWith('.json')) {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new RekeyMappingError('JSON mapping must be an array');
    }
    pairs = parsed.map((row: any) => [
      String(row?.oldId ?? ''),
      String(row?.newId ?? ''),
    ]);
  } else {
    const [header, ...rows] = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const columns = (header ?? '').split(',').map((c) => c.trim());
    const oldAt = columns.indexOf('old_id');
    const newAt = columns.indexOf('new_id');
    if (oldAt < 0 || newAt < 0) {
      throw new RekeyMappingError('CSV mapping needs an old_id,new_id header');
    }
    pairs = rows.map((line) => {
      const cells = line.split(',').map((c) => c.trim());
      return [cells[oldAt] ?? '', cells[newAt] ?? ''];
    });
  }

  const mapping = new Map<string, string>();
  for (const [oldId, newId] of pairs) {
    if (!oldId || !newId) {
      throw new RekeyMappingError(`empty id in pair "${oldId}" -> "${newId}"`);
    }
    if (oldId === newId) {
      throw new RekeyMappingError(`${oldId} is mapped to itself`);
    }
    const existing = mapping.get(oldId);
    if (existing !== undefined && existing !== newId) {
      throw new RekeyMappingError(
        `${oldId} is mapped to both ${existing} and ${newId}`,
      );
    }
    mapping.set(oldId, newId);
  }
  if (mapping.size === 0) {
    throw new RekeyMappingError('mapping has no rows');
  }
  for (const newId of mapping.values()) {
    if (mapping.has(newId)) {
      throw new RekeyMappingError(
        `${newId} is both a new id and an old id: a chained mapping is not idempotent`,
      );
    }
  }
  return mapping;
}

/** Maps old ids to new ones, keeping order and dropping duplicates it creates. */
function rewriteIds(
  ids: unknown,
  mapping: Map<string, string>,
): { next: unknown; replaced: number } {
  if (!Array.isArray(ids)) return { next: ids, replaced: 0 };
  let replaced = 0;
  const seen = new Set<string>();
  const next: unknown[] = [];
  for (const id of ids) {
    const key = typeof id === 'string' ? id : String(id);
    const mapped = mapping.get(key);
    if (mapped !== undefined) replaced += 1;
    const value = mapped ?? key;
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(mapped ?? id);
  }
  return { next, replaced };
}

function rewriteSections(
  sections: any[],
  mapping: Map<string, string>,
): { next: any[]; replaced: number } {
  let replaced = 0;
  const next = (sections ?? []).map((section) => ({
    ...section,
    sources: (section?.sources ?? []).map((source: any) => {
      if (!Array.isArray(source?.resourceIds)) return source;
      const result = rewriteIds(source.resourceIds, mapping);
      replaced += result.replaced;
      return result.replaced > 0
        ? { ...source, resourceIds: result.next }
        : source;
    }),
  }));
  return { next, replaced };
}

async function rewriteCollection(
  collection: RewriteCollection,
  options: RewriteOptions,
  idsPath: string,
  rewrite: (doc: any) => { set: object; replaced: number },
): Promise<CollectionReport> {
  const oldIds = [...options.mapping.keys()];
  const docs = await collection
    .find({ tenantId: options.tenantId, [idsPath]: { $in: oldIds } })
    .toArray();

  const report: CollectionReport = {
    matched: docs.length,
    changed: 0,
    idsReplaced: 0,
    skipped: 0,
  };

  for (const doc of docs) {
    const { set, replaced } = rewrite(doc);
    if (replaced === 0) continue;
    if (options.dryRun) {
      report.changed += 1;
      report.idsReplaced += replaced;
      continue;
    }
    const result = await collection.updateOne(
      {
        _id: doc._id,
        tenantId: options.tenantId,
        // null matches a legacy document with no updatedAt, as on the read.
        updatedAt: doc.updatedAt ?? null,
      },
      { $set: set },
    );
    if (result.matchedCount === 0) {
      report.skipped += 1;
      continue;
    }
    report.changed += 1;
    report.idsReplaced += replaced;
  }
  return report;
}

export async function rewriteSavedIds(
  collections: RewriteCollections,
  options: RewriteOptions,
): Promise<RewriteReport> {
  if (!options.tenantId) {
    throw new RekeyMappingError('a tenantId is required');
  }
  const oldIds = [...options.mapping.keys()];

  const withRow = await collections.redirects.countDocuments({
    _id: { $in: oldIds },
    tenantId: options.tenantId,
  });

  const favoriteLists = await rewriteCollection(
    collections.favoriteLists,
    options,
    'favorites',
    (doc) => {
      const { next, replaced } = rewriteIds(doc.favorites, options.mapping);
      return { set: { favorites: next }, replaced };
    },
  );

  const printableDirectories = await rewriteCollection(
    collections.printableDirectories,
    options,
    DIRECTORY_IDS_PATH,
    (doc) => {
      const { next, replaced } = rewriteSections(doc.sections, options.mapping);
      return { set: { sections: next }, replaced };
    },
  );

  const [tenantlessLists, tenantlessDirectories] = await Promise.all([
    collections.favoriteLists.countDocuments({
      tenantId: NO_TENANT,
      favorites: { $in: oldIds },
    }),
    collections.printableDirectories.countDocuments({
      tenantId: NO_TENANT,
      [DIRECTORY_IDS_PATH]: { $in: oldIds },
    }),
  ]);

  return {
    tenantId: options.tenantId,
    dryRun: options.dryRun,
    mapping: {
      entries: options.mapping.size,
      withoutRedirectRow: options.mapping.size - withRow,
    },
    favoriteLists,
    printableDirectories,
    tenantless: {
      favoriteLists: tenantlessLists,
      printableDirectories: tenantlessDirectories,
    },
  };
}

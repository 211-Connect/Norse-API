# Saved ids across a re-key

When a tenant is re-keyed, every service-at-location id changes once. Saved
references must still reach their records. There are two mechanisms, and a
cutover needs both.

## 1. Read-time: `redirects` (ISS-2514, ISS-2516)

Mongo `redirects` holds `{ _id: <old SAL id>, newId: <new SAL id>, tenantId }`.
Every lookup is **tenant-scoped**: a row for tenant X never redirects tenant Y.

- `GET /resource/:id` and `GET /resource/original/:id`: a miss with a row
  answers 404 with `redirect: "/search/<newId>"` (`ResourceNotFoundResponseDto`).
  Norse turns that into a 308. `HttpExceptionFilter` passes `redirect`
  through by name and nothing else.
- `POST /resource/batch`: a miss with a row resolves the new id (one hop,
  tenant-scoped) and returns the record in `data` **under the requested old
  id**, because every caller indexes by its own ids. `redirects` maps
  requested id → new id. A row whose target does not resolve stays an error.
- `findTitlesByIds` (printable-directory editor titles) follows rows the same
  way.

Anonymous favorites live in the visitor's browser, so read-time is the only
way they survive. Norse renames them in local storage when the batch answers
with a different id.

## 2. Cutover: rewrite stored ids (ISS-2516, run in ISS-2519)

`scripts/rewrite-saved-ids.ts` replaces old ids with new ones in one tenant's
`favoriteLists.favorites` and `printableDirectories` `resource_ids` sources.

```bash
MONGODB_URI=... npx ts-node -r tsconfig-paths/register \
  scripts/rewrite-saved-ids.ts --tenant <uuid> --mapping <file.csv|file.json>          # dry run
MONGODB_URI=... npx ts-node -r tsconfig-paths/register \
  scripts/rewrite-saved-ids.ts --tenant <uuid> --mapping <file.csv|file.json> --apply  # write
```

- The mapping is a CSV with an `old_id,new_id` header, or JSON `[{ "oldId", "newId" }]`.
  It is refused when an id maps to itself, one old id has two targets, an id
  is empty, or the mapping chains (a new id is also an old id). A chain would
  make a second run change data again.
- It is **dry run by default**. The report has the same counts either way:
  `matched`, `changed`, `idsReplaced` and `skipped` per collection.
- Every read and write filters on `tenantId`. Documents with **no** tenantId
  are never touched; `tenantless` counts the ones that hold a mapped id.
- It is idempotent: a second `--apply` writes nothing.
- Each write is conditional on the `updatedAt` it read. A document saved in
  between is `skipped`, not overwritten. `updatedAt` is not bumped.
- `mapping.withoutRedirectRow` counts mapping entries with no `redirects` row
  for the tenant. Seed the rows first (step 1); they serve every reference
  this script cannot reach.

Not covered: organization ids in query sources (`params.organization_id`),
which ISS-2517 handles.

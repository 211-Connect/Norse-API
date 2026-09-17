# Service-at-Location: the `DISPLAY` view on `GET /organization/:id`

Each service in the organization detail response carries
`SERVICE_AT_LOCATIONS[]` — one entry per location that service is offered at.
Alongside the link itself, each entry carries a `DISPLAY` object: **what a
seeker is actually shown for this service at this location**, resolved by the
same tenant rules the search index uses.

This doc exists because `DISPLAY` looks editable and is not, and because the
two things inside it that vary by location vary for *different reasons*.

## Why the field exists

An organization document and a search result are built from the same HSDS data
but answer different questions.

- `GET /organization/:id` returns the **normalized record**: every phone, every
  schedule, every contact, each addressable by its own `ID`. Good for editing,
  because everything you might want to change is a real row you can name.
- A search result is the **resolved view**: for one service at one location, the
  single number to call and the single set of hours, chosen by that tenant's
  ranking rules (`ts_rank_phone`, `ts_rank_contacts`, `ts_rank_schedule` in the
  dbt layer).

Before `DISPLAY`, a consumer holding the organization document could not tell
what a seeker sees. Someone reporting "the phone number on this listing is
wrong" from a public search result arrived at a form showing the unresolved
union of every phone on the organization — not the one they were complaining
about. `DISPLAY` closes that gap in the same round trip, without a second call
to `POST /resource/batch`.

## Read-only, and why that matters

**Nothing in `DISPLAY` is a record.** Every value in it is derived from a phone,
contact or schedule row that also appears — with its own `ID` — under the
service, under the location, or in the organization's top-level `phones` /
`contacts` arrays.

To propose a change, target that underlying row by its `ID`. A value in
`DISPLAY` has no row behind it to write to, so a change proposed against
`DISPLAY.PHONE_NUMBER` has no destination in the source system.

`DISPLAY` may be absent. That is not an error: it means the tenant's rules
produced no display row for that pairing. The pairing is still real and its
`ID` still resolves through `POST /resource/batch`.

## The two fields that actually vary — and how they differ

Only two things meaningfully differ between two locations of the same service.
Name, alternate name and description resolve identically at every location, so
they are not repeated here — read them off the service.

### `PHONE_LIST` / `PHONE_NUMBER` — a merge

The organization's, the service's, the location's and the pairing's own phones
are **merged into one list**, then ordered by the tenant's ranking rules.
`PRIORITY` 0 is what the seeker sees first, and is what `PHONE_NUMBER` repeats.

A location phone does **not** replace the service's. It joins the list, ahead of
or behind it depending on the tenant. So "this location has a different number"
usually means *an additional number sorted first*, not a substitution — which is
why there is no per-location override value to edit. The thing to change is
whichever phone row is wrong, or its ranking.

### `TRANSLATIONS[].DISPLAY_SCHEDULE` — a substitution

This one really is a pick. The tenant rules select a **single winning schedule**
for the pairing — the service's where it has one, otherwise the location's — and
only the winner appears. The candidates it beat are not represented here.

One entry per locale.

> **The key is named `TRANSLATIONS`, not `SCHEDULES`, on purpose.**
> `filterTranslationsByLocale` (`organization-detail.transform.ts`) narrows every
> array found under a key named `translations` to the requested locale, walking
> the whole document. Naming this key anything else would make it the one node
> that silently returns every locale while the rest of the document is filtered.
> There is a regression test for this in `organization-detail.service.spec.ts`.

## `SCHEDULES` on the pairing — editable, and easy to miss

Separately from `DISPLAY`, each `SERVICE_AT_LOCATIONS[]` entry carries a
`SCHEDULES` array. These are **source rows with their own IDs — editable**.

HSDS allows a schedule to hang off a `service_at_location`, and such a row
carries neither a `service_id` nor a `location_id`. It therefore appears in this
array **and nowhere else in the document** — not under the service, not under
the location. A consumer that reads schedules only from `services[].SCHEDULES`
and `locations[].SCHEDULES` will silently miss them.

Tenants where this is populated today: OH211, AR211, NJ211, METROCH211, MD211,
HLC211. It is empty everywhere else, including every WellSky-sourced tenant.

## Where the data comes from

`app_organization_full` in `dagster-data-orchestration`
(`lib/dbt_packages/app_core/models/application/`) builds these fields by joining
`app_display` at service-at-location grain, then the configurable reader writes
the row into the Mongo `organizations` collection. `DISPLAY` is deliberately
trimmed relative to `app_service_at_location_full.display_translations`: it
omits the display name, alternate name and description, which are service-level
and already on the service object.

The trim is a size decision as much as a modelling one. The largest MD211
organization has 666 service-at-locations against a document already near 5 MB,
and MongoDB's ceiling is 16 MB; the untrimmed array would have added roughly
1.1 MB to it for no new information.

# Service-at-Location: the `DISPLAY` view on `GET /organization/:id`

Each service in the organization detail response carries
`SERVICE_AT_LOCATIONS[]` — one entry per location that service is offered at.
Each entry carries a `DISPLAY` object: **what a seeker is shown for this service
at this location**, resolved by the same tenant rules the search index uses.

This doc exists because `DISPLAY` looks editable and is not, and because the two
things inside it that vary by location vary for *different reasons*.

## Why the field exists

`GET /organization/:id` returns the **normalized record** — every phone,
schedule and contact addressable by its own `ID`, which is what makes it good
for editing. A search result is the **resolved view** — for one service at one
location, the single number to call and the single set of hours, picked by that
tenant's ranking rules (`ts_rank_phone`, `ts_rank_contacts`, `ts_rank_schedule`
in the dbt layer).

Before `DISPLAY`, a consumer holding the organization document could not tell
what a seeker sees. Someone reporting "the phone number on this listing is
wrong" arrived at a form showing the unresolved union of every phone on the
organization — not the one they were complaining about.

## Read-only

**Nothing in `DISPLAY` is a record.** Every value is derived from a phone,
contact or schedule row that also appears — with its own `ID` — under the
service, the location, or the organization's top-level `phones` / `contacts`
arrays. To propose a change, target that underlying row by its `ID`; a value in
`DISPLAY` has no row behind it to write to.

`DISPLAY` may be absent. That means the tenant's rules produced no display row
for the pairing, not that anything is wrong — the pairing is still real and its
`ID` still resolves through `POST /resource/batch`.

## The two fields that vary — and how they differ

Name, alternate name and description resolve identically at every location, so
they are not repeated in `DISPLAY`. Read them off the service.

**`PHONE_LIST` / `PHONE_NUMBER` is a merge.** The organization's, service's,
location's and pairing's phones are combined into one tenant-ranked list;
`PHONE_NUMBER` repeats the first entry. A location phone does **not** replace
the service's — it sorts ahead of or behind it. So "this location has a
different number" usually means *an additional number sorted first*, and there
is no per-location override to edit: fix whichever phone row is wrong, or its
ranking.

**`TRANSLATIONS[].DISPLAY_SCHEDULE` is a substitution.** The rules pick a single
winning schedule for the pairing — the service's where it has one, otherwise the
location's — and only the winner appears, one entry per locale.

> **That key is named `TRANSLATIONS`, not `SCHEDULES`, on purpose.**
> `filterTranslationsByLocale` (`organization-detail.transform.ts`) narrows every
> array under a key named `translations` to the requested locale, walking the
> whole document. Any other name would make this the one node that silently
> returns every locale. Regression test in `organization-detail.service.spec.ts`.

## `SCHEDULES` on the pairing — editable, and easy to miss

Separately from `DISPLAY`, each entry carries a `SCHEDULES` array of **source
rows with their own IDs**. HSDS allows a schedule to hang off a
`service_at_location`, and such a row carries neither a `service_id` nor a
`location_id` — so it appears here and **nowhere else in the document**. A
consumer reading schedules only from `services[].SCHEDULES` and
`locations[].SCHEDULES` misses them silently.

Populated by several directly-sourced tenants; empty in every WellSky-sourced
tenant (as of 2026-09).

## Where the data comes from

`app_organization_full` in `dagster-data-orchestration`
(`lib/dbt_packages/app_core/models/application/`) joins `app_display` at
service-at-location grain; the configurable reader writes the row into the Mongo
`organizations` collection.

`DISPLAY` is deliberately trimmed relative to
`app_service_at_location_full.display_translations`, omitting the service-level
display name, alternate name and description. That is a size decision as much as
a modelling one: the largest MD211 organization has 666 service-at-locations
against a document already near 5 MB (MongoDB's ceiling is 16 MB), and the
untrimmed array would have added roughly 1.1 MB for no new information.

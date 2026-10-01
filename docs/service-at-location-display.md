# Service-at-Location: the `DISPLAY` view on `GET /organization/:id`

Each service in the organization detail response carries `SERVICE_AT_LOCATIONS[]`,
one entry per location that service is offered at. Each entry carries `DISPLAY`:
what a seeker is shown for this service at that location.

Per-field semantics live on the DTO (`organization-detail-response.dto.ts`) and
reach consumers through the generated SDK. This doc holds the two things that
never reach a consumer and that testing will not teach you.

## Why the field exists

`GET /organization/:id` is the normalized record — every phone, schedule and
contact addressable by its own `ID`, which is what makes it editable. A search
result is the resolved view: for one service at one location, the single number
to call and the single set of hours, picked by that tenant's ranking rules.

Before `DISPLAY`, a consumer holding the organization document could not tell
what a seeker sees. Someone reporting "the phone number on this listing is
wrong" arrived at a form showing the unresolved union of every phone on the
organization — not the one they were complaining about.

## It is English, deliberately

`DISPLAY.SCHEDULE` is a scalar and the `TRANSLATIONS` nested in `PHONE_LIST` and
`CONTACT_LIST` are filtered to `en` — upstream in `app_organization_full`, not
here. That matches the rest of this document, where the service, location,
program and attribute translations are each already filtered to `en`, and it
matches how the document is used: feedback is given in English, stewards steward
in English, and translation happens downstream in the pipeline.

So an `accept-language: es` request still gets the English row, via the English
fallback in `selectLocaleRows`. That is correct — it is the only row there is.

`app_display` upstream stays multi-locale, because the search index reads it and
serves every configured locale. Don't "fix" that by widening this.

## Why there is no per-location override to edit

The DTO says `PHONE_LIST` is merged and `DISPLAY_SCHEDULE` is a single winner.
The consequence is the part worth stating once: a location phone joins the list
rather than replacing the service's, so "this location has a different number"
is an *additional* number sorted first, not a substitution. There is no
per-location value to correct — fix whichever phone row is wrong, or its
ranking.

`SERVICE_AT_LOCATIONS[].SCHEDULES`, sitting beside `DISPLAY`, is the opposite:
real source rows with IDs, reachable nowhere else in the document. A consumer
reading schedules only from `services[]` and `locations[]` misses them silently.

## Upstream

Built by `app_organization_full` in `dagster-data-orchestration`
(`lib/dbt_packages/app_core/models/application/`), which joins `app_display` at
service-at-location grain. See that model for what `DISPLAY` carries and why it
is trimmed.

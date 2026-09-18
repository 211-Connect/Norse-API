# `rank` and `PRIORITY`: two fields, two bases

Both name an ordering. Neither is a score — **lower is better in both**. But they
do not start from the same number, and the arrays that carry them are not
reliably sorted. Both facts have already produced bugs.

## The two bases

| field | where | base | primary is |
|---|---|---|---|
| `rank` on **phone numbers** | `/resource`, `/search` | **zero-based** | `rank === 0` |
| `rank` on **addresses** | `/resource`, `/search` | **one-based** | `rank === 1` |
| `PRIORITY` on phones/contacts | `/organization/:id` | **zero-based** | `PRIORITY === 0` |

Measured on a live tenant: every address carries `rank: 1`, while phone ranks run
`0 … 13`. Phone rank `0` is always a voice line — fax first appears at rank 1.

This asymmetry is live in the Norse frontend. `addresses.find(a => a.rank === 1)`
is correct. The same pattern applied to phones — `phoneNumbers.find(p => p.rank
=== 1 && p.type === 'voice')` — selects the *second* phone, and is only masked by
the `type` guard skipping the fax cases. Treat the two as unrelated fields that
happen to share a name.

## The arrays are not sorted

Do not read element `0` as the primary. Sort by the rank field first.

`app_display` upstream aggregates its arrays `within group (order by
obj.service_at_location_id)` — a column that is constant inside the group — so the
sequence it emits is unspecified, and in practice random: on one tenant, 445 of
868 two-phone pairings came out ascending and 423 descending.

Where each array lands differs, which is easy to trip over:

- **`resource.phoneNumbers`** (top level) is explicitly sorted upstream so the
  primary leads. Measured: correct 100% of the time.
- **`resource.translations[].phoneNumbers`** is built from the raw display list and
  is **not** sorted — it leads with the primary about 42% of the time. This is the
  array the Norse frontend actually renders, because it prefers the localized one.
- **`SERVICE_AT_LOCATIONS[].DISPLAY.PHONE_LIST`** on `/organization/:id` *is*
  sorted by `PRIORITY`, with a dbt test pinning it.

The headline number is safe everywhere: `displayPhoneNumber` /
`DISPLAY.PHONE_NUMBER` derive from the rank-0 row directly rather than from array
position. It is the rendered *list* that is affected.

## If you are fixing this

Sort where the array is built, not in each consumer. For the organization document
that is done. For the resource document the unsorted path is `_build_phone_numbers`
in the dagster resource connector, which feeds the translations array — sorting
there would cover every consumer at once.

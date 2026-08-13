# Cross-system stewardship

Start from the issue and local code. If investigation finds or may find an
endpoint, DTO, API version, data store, queue/event, or authentication boundary,
follow `../architecture-docs/SKILL.md`: discover the actual boundary, then use
the catalog for impact and evidence. Update it when the boundary changes and
run `npm run validate` there.

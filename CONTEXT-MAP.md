# Context Map

This repo uses **multi-context** domain docs. Each subsystem owns its `CONTEXT.md`
and (optionally) its `docs/adr/`. System-wide decisions live in `docs/adr/` at the root.

## Contexts

| Context | Domain doc                | ADRs                          |
| ------- | ------------------------- | ----------------------------- |
| `orm`   | `src/orm/CONTEXT.md`      | `src/orm/docs/adr/` (planned) |

Add a new row when a subsystem's vocabulary stabilises enough to deserve its own
`CONTEXT.md`. `/grill-with-docs` creates these lazily as terms get resolved.

# equipped

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `kevinand11/equipped` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `docs/CONTEXT-MAP.md` points at per-module `CONTEXT.md` files under `docs/<context>/CONTEXT.md` (e.g. `docs/orm/CONTEXT.md`). All ADRs live at `docs/adr/`. See `docs/agents/domain.md`.

### Commit convention

This repo follows `@commitlint/config-conventional` (Conventional Commits), enforced by a Husky `commit-msg` hook. Use `<type>(<scope>)?: <subject>` with imperative-mood lowercase subjects and no trailing period. See `docs/agents/commit-convention.md`.

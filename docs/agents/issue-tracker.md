# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## PRDs and slice issues

A PRD is a long-form parent issue describing a whole feature. Slice issues are the narrow vertical slices that implement it. The relationship is **structural**, expressed via GitHub's native sub-issues feature — not via textual `## Parent #N` references.

When a skill publishes slice issues for a PRD:

1. Create each slice issue normally with `gh issue create`.
2. Link each slice as a sub-issue of the PRD via the REST API (no `gh` subcommand exists for this yet):

   ```bash
   parent_id=$(gh api repos/<owner>/<repo>/issues/<prd-number> --jq .id)
   for n in <slice-numbers>; do
     child_id=$(gh api repos/<owner>/<repo>/issues/$n --jq .id)
     gh api -X POST repos/<owner>/<repo>/issues/<prd-number>/sub_issues -F sub_issue_id="$child_id"
   done
   ```

   `sub_issue_id` is the issue's *internal numeric ID* (the `id` field), not the issue `number`.

3. Omit the `## Parent` section from the slice's body — the parent/child relationship is now structural and visible in the GitHub UI's sub-issues panel.

Limits: each parent supports up to 100 direct sub-issues, nested up to 8 levels deep.

## Feature branches for PRDs

By convention, each PRD has an integration branch named `feature/issue-<prd-number>` (e.g. PRD #27 → `feature/issue-27`). Slice PRs target this branch, not `main`. The whole feature merges into `main` as one squash when every slice has landed.

The branch must exist on `origin` before Sandcastle can run against the PRD; create it once with `git push origin main:feature/issue-<prd-number>`.

## Declaring dependencies between issues

When an issue cannot be worked on until another issue is resolved, declare the dependency in the issue body using either form below.

**Inline form** — a line beginning with `Depends on` or `Blocked by`:

```
Depends on #42
Blocked by #50
Depends on #8 (slice 7 — upsert), #10 (slice 9 — ContextSource)
```

**Block form** — a `## Depends on` or `## Blocked by` heading, followed by a blank line, followed by one or more lines containing the issue refs:

```
## Blocked by

#28, #29
```

Rules:

- The keywords `Depends on` and `Blocked by` are interchangeable; matching is case-insensitive.
- **Inline form**: the line must begin with the keyword (after optional indentation). Mid-paragraph mentions like "this depends on #42 in some way" are ignored.
- **Block form**: the heading line must consist of `## Depends on` or `## Blocked by` (case-insensitive, optional trailing whitespace) and nothing else. The parser then collects bare `#N` refs from each subsequent line until it hits the next heading, a blank-line-followed-by-prose, or end of body.
- In both forms, multiple refs on a single line are fine and parenthetical annotations are fine. The parser collects every bare `#N` up to the first sentence terminator (`.` or `;`), so trailing prose like `#8, #10. Parallel-safe with #11.` resolves to `{8, 10}` (not 11).
- Bare `#N` only — cross-repo references (`owner/repo#N`) are not supported.
- A dependency is considered resolved when the referenced issue is in the `CLOSED` state, regardless of close reason.
- Sandcastle's loop runs a host-side resolver before the planner picks up issues; any dependent whose deps aren't all closed is skipped that iteration with a console log naming the open dep.
- Cycles (`A → B → A`), self-references, and references to non-existent issues hard-fail the loop with an explicit error. Fix the trailer and re-run.

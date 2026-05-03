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

## Declaring dependencies between issues

When an issue cannot be worked on until another issue is resolved, declare the dependency in the issue body using a trailer:

```
Depends on #42
Blocked by #50
```

Rules:

- One number per line. The keywords `Depends on` and `Blocked by` are interchangeable; matching is case-insensitive.
- The trailer must occupy its own line — mid-paragraph mentions like "this depends on #42 in some way" are ignored.
- Bare `#N` only — cross-repo references (`owner/repo#N`) are not supported.
- A dependency is considered resolved when the referenced issue is in the `CLOSED` state, regardless of close reason.
- Sandcastle's loop runs a host-side resolver before the planner picks up issues; any dependent whose deps aren't all closed is skipped that iteration with a console log naming the open dep.
- Cycles (`A → B → A`), self-references, and references to non-existent issues hard-fail the loop with an explicit error. Fix the trailer and re-run.

# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Sandcastle-managed labels

[Sandcastle](https://github.com/mattpocock/sandcastle) is the AFK agent in use here, so `ready-for-agent` doubles as Sandcastle's entry gate — there is no separate `Sandcastle` label. The labels below sit alongside `ready-for-agent` and track Sandcastle's lifecycle around it.

| Label             | Applied by | Meaning                                                                                                                                                                                                                                                |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `needs-revision`  | Reviewer   | Reviewer wants Sandcastle to take another pass at this PR — applied on the PR (not the issue) after leaving review comments. GitHub blocks PR authors from formally requesting changes on their own PR, so this label is the trigger. Sandcastle removes it after pushing a fix; re-apply for further iterations. |

### Lifecycle

1. Issue starts at `needs-triage`.
2. Maintainer evaluates; when AFK-ready, applies `ready-for-agent`. The issue should be a sub-issue of a PRD whose integration branch (`prds-issue-<N>`) already exists on origin.
3. A dev runs the sandcastle loop scoped to a specific PRD. Multiple devs can run loops in parallel for different PRDs without colliding.
4. Sandcastle picks up open sub-issues of the scoped PRD that carry `ready-for-agent`, skipping any with unresolved `Depends on` / `Blocked by` trailers, on its next iteration.
5. After implementation + review, Sandcastle pushes `sandcastle/issue-<N>` and opens a draft PR targeting the PRD's integration branch.
6. A human reviews the PR. Merging it merges the slice into the integration branch; the PRD ships to `main` as one squash when every slice has landed. To request changes, the reviewer leaves comments on the PR and applies the `needs-revision` label — Sandcastle's addresser picks it up on the next iteration. Sandcastle removes the label after pushing a fix; re-apply for additional rounds.

### Notes for maintainers

- Issue-to-issue dependencies are declared as `Depends on #N` / `Blocked by #N` trailers in the issue body. The host resolver runs before the planner each iteration: dependents whose deps aren't all closed get skipped (logged to console); missing references and cycles hard-fail the loop. See [`docs/agents/issue-tracker.md`](./issue-tracker.md#declaring-dependencies-between-issues) for the full convention.

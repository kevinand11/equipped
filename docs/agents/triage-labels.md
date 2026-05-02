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
| `feature/<slug>`  | Maintainer | Target feature branch the issue's PR will be opened against. Each `ready-for-agent` issue must carry exactly one `feature/*` label or the loop halts.                                                                                                  |
| `in-pr`           | Sandcastle | A Sandcastle PR for this issue is open and awaiting human review. Auto-applied on PR creation; human-removed only if the PR is closed without merge.                                                                                                   |
| `needs-revision`  | Reviewer   | Reviewer wants Sandcastle to take another pass at this PR — applied on the PR (not the issue) after leaving review comments. GitHub blocks PR authors from formally requesting changes on their own PR, so this label is the trigger. Sandcastle removes it after pushing a fix; re-apply for further iterations. |

### Lifecycle

1. Issue starts at `needs-triage`.
2. Maintainer evaluates; when AFK-ready, applies `ready-for-agent` and exactly one `feature/<slug>` label naming the target branch.
3. A dev runs the loop scoped to a specific feature: `npm run sandcastle -- feature/<slug>` (or with a custom iteration cap, `npm run sandcastle -- feature/<slug> --max-iterations 5`). The feature arg is required; the loop refuses to start without it. Multiple devs can run loops in parallel for different features without colliding.
4. Sandcastle's planner picks up issues matching `label:ready-for-agent label:"feature/<slug>" -label:in-pr` on its next iteration.
5. After implementation + review, Sandcastle pushes a branch and opens a PR targeting the feature branch, then auto-applies `in-pr` so subsequent iterations skip the issue.
6. A human reviews the PR. Merging closes the issue (PR body uses `Closes #<id>`). To request changes, the reviewer leaves comments on the PR and applies the `needs-revision` label — this triggers Sandcastle's Phase 0 addresser on the next iteration of any loop scoped to the same feature. Sandcastle removes the label after pushing a fix; re-apply it for additional rounds.

### Notes for maintainers

- `feature/<slug>` labels must correspond to feature branches that already exist on origin. Sandcastle does not auto-create feature branches — see `.sandcastle/main.ts` for the validation check that halts the loop on missing branches.
- An issue with two or more `feature/*` labels halts the loop. Resolve ambiguity before running.
- Removing `in-pr` from a closed-without-merge issue causes Sandcastle to re-pick it on the next iteration. If you don't want a re-attempt, close the issue too.

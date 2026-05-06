# Sandcastle

Sandcastle is the orchestration loop in `.sandcastle/main.ts`. It walks a PRD's
sub-issues and shepherds each one from "ready for an agent" to "PR opened for
human review." Multiple devs can run scoped loops for *different* PRDs in
parallel; same-PRD double-runs are user-error and not enforced against.

## Scope

- **In scope:** opening draft PRs, running review, addressing reviewer
  feedback, recovering from interruption (Claude rate limits, network drops,
  process kills) without manual intervention.
- **Out of scope:** auto-merging, auto-rebasing onto a moved integration
  branch, detecting implicit conflicts between parallel issues (overlapping
  files, semantic interactions), enforcing concurrency.

## Core principles

1. **Origin is the source of truth.** PR existence and draft state encode
   phase progress; branch ahead-of-base count encodes implementer progress.
   The orchestrator reads from origin to determine what to do next; it never
   relies on in-memory or sidecar state.
2. **Push-only-on-success.** Sandbox steps (implementer, reviewer, addresser)
   push to origin only if the agent step completes without throwing. The act
   of pushing *is* the success signal.
3. **The orchestrator never authors state-tracking labels.** It only
   *removes* human-set directive labels (`ready-for-agent`,
   `needs-revision`) once the directive is consumed or abandoned. Labels are
   humans-talking-to-the-orchestrator, never orchestrator-talking-to-itself.
4. **Pre-flight directive check before every push.** Before any
   orchestrator-initiated push, re-check the directive labels and parent
   state on origin. If the directive has been revoked (issue closed, label
   removed, PR merged), discard the work and exit clean.
5. **Each issue runs end-to-end independently.** No batch barriers. A fast
   issue's PR opens while a slow issue is still implementing.

## Branch naming

Deterministic: `sandcastle/issue-<N>`.

The orchestrator looks up linked branches via `gh` first; only creates the
branch if absent. The branch name does **not** depend on the issue title,
which can drift across runs.

## Directive labels (the human↔orchestrator interface)

| Label | Set by | Means | Removed by |
|---|---|---|---|
| `ready-for-agent` | Human (triage) | This issue is agent-territory; pick it up | Orchestrator, on 0-commit clean exit |
| `needs-revision` | Human (PR reviewer) | Run the addresser on this PR | Orchestrator, after addresser run |

The orchestrator does **not** use any other labels for state tracking. There
is no `in-pr`, no `sandcastle:attempts/N`, no `needs-human`. The orchestrator
infers state from PR existence + draft state + branch ahead-count.

## Per-issue state machine

```
classify(issue):
  prs = gh pr list --head sandcastle/issue-<N> --state all
  if any PR is merged: return 'done'
  if exactly one open PR:
    if PR.isDraft: return 'review'
    if PR.labels includes 'needs-revision': return 'address'
    return 'done'  # awaiting human merge
  if branch has commits ahead of integration branch: return 'create-pr-then-review'
  return 'implement'
```

The `--state all` query catches the case where a PR has merged but the issue
remained open (PRs target the integration branch, not `main`, so `Closes #N`
keywords don't auto-close).

## Per-issue actions

| State | Action |
|---|---|
| `implement` | Run implementer in fresh sandbox. On 0 commits with clean exit: log + remove `ready-for-agent`. On 0 commits with cap reached: return `partial` (retry next run). On commits: pre-flight check → push branch → `gh pr create --draft`. |
| `create-pr-then-review` | Self-heal: run only `gh pr create --draft`, then re-classify (will be `review`). |
| `review` | Run reviewer in fresh sandbox. Push fixups if any. `gh pr ready` only on clean exit; on cap reached, return `partial` (retry next run). |
| `address` | Run addresser in fresh sandbox. On 0 commits with clean exit: remove `needs-revision`. On 0 commits with cap reached: return `partial`. On commits: pre-flight check → push fixups → remove `needs-revision`. |
| `done` | Skip. |

The reviewer always clones origin/`<branch>` fresh — no in-memory carry-over
from the implementer. It sees what humans see.

### Clean exit vs cap reached

Sandcastle's agent loop terminates on whichever comes first: the agent emits
its `completionSignal` (default `<promise>COMPLETE</promise>`) — a *clean
exit* — or `maxIterations` is reached — *cap reached*. The orchestrator
distinguishes them and only treats clean exit as the agent's verdict:

```ts
function exitedCleanly(result, capIterations): boolean {
  // Prefer a structured field if the library exposes one; otherwise infer:
  // ran fewer iterations than the cap ⇒ agent emitted COMPLETE.
  return result.iterations.length < capIterations
}
```

Principle: **only the agent's own COMPLETE signal authorizes a terminal
transition** (`'no-work'`, `'done'`, `gh pr ready`, removing a directive
label). Cap reached means "out of budget, retry."

### maxIterations per step

| Step | Cap | Why |
|---|---|---|
| Implementer | 100 | Read code, run tests, edit, re-run, commit, repeat — many turns. |
| Addresser | 50 | Targeted changes against PR comments — fewer turns. |
| Reviewer | 1 | Single shot: read diff → push fixups or not → emit COMPLETE. The reviewer is intentionally not given room to iterate; quality bar is enforced by prompt discipline (binary verdict, lenient bar), not by extra turns. |

Each agent's prompt **must** instruct it to emit `<promise>COMPLETE</promise>`
when its work is done. Without it, every run hits the cap and the orchestrator
treats every outcome as `partial` — terminal transitions never fire and the
issue stays in its current state forever.

## Main loop shape

```
for iteration in 1..MAX_ITERATIONS:
  candidates = fetch open sub-issues with `ready-for-agent`
  if none: break
  classify each
  in_flight = those at review|address|create-pr-then-review
  fresh = those at implement
  fresh_unblocked = filter by declared `Depends on #N` / `Blocked by #N` trailers
  issues = in_flight ++ fresh_unblocked
  if none: break
  Promise.allSettled(issues.map(processIssue))
```

The dep filter only applies to fresh implementations. Already-in-flight
issues bypass — their work was approved when they were originally picked up.

The per-issue coroutine has a step-cap (5) to prevent runaway state-machine
loops. The legitimate path is at most 3 transitions; hitting the cap means
something unexpected and the issue is left in its current state for the next
iteration to pick up.

## Failure modes and recovery

| Failure | Recovery |
|---|---|
| Sandbox crashes mid-run (rate limit, network, OOM) | No push happened → state on origin unchanged → next run re-classifies and re-runs the same phase from scratch. The same sandbox-step is the unit of atomicity. |
| Implementer completes with 0 commits, clean exit | Remove `ready-for-agent`; log. Issue drops from candidates. Human re-adds the label to retry. |
| Implementer completes with 0 commits, cap reached | Return `partial`. Issue keeps `ready-for-agent`. Next run retries. |
| Push succeeds, draft-PR-create fails | Branch ahead + no PR → `create-pr-then-review` self-heal on next pass. |
| Reviewer push succeeds, `gh pr ready` fails | Draft PR remains → next run re-runs reviewer. With a disciplined reviewer prompt (binary verdict, lenient bar) it converges to ready in one or two passes. |
| Human revokes a directive mid-sandbox-run (closes issue, removes label, merges PR) | Pre-flight check before push detects the revocation, discards work, exits clean. |
| Stale base (sibling issue merged into integration branch) | Accepted. Human resolves at PR-merge time. Recovery runs re-fetch the integration tip before classifying. |
| Same-PRD double-run | Diagnostic log on `git push` rejection. No enforcement. |
| Step-cap reached on a per-issue coroutine | Warn + leave in current state for next main-loop iteration. |

## What this design deliberately does *not* do

- **Auto-rebase.** Slice-PR workflows route everything through human review;
  conflicts surface at merge time and humans handle them. Auto-rebasing on a
  branch with an open draft PR causes mid-review surprises for marginal
  benefit.
- **Implicit-conflict detection.** A planner could examine overlapping files
  or domain contexts and serialize parallel-unsafe issues. Out of scope.
  Issues with semantic conflicts surface as merge issues; the human
  resolves.
- **Concurrency enforcement.** No lock files, no run-state labels. The CLI
  documents the constraint ("different PRDs in parallel"); the recovery
  design self-heals collisions when they happen.
- **Retries beyond what GitHub state encodes.** No attempt counters, no
  exponential backoff, no `needs-human` label. A clean-exit-zero-commits is
  the agent's decision; the orchestrator honors it and bails to the human.
- **A planner / scheduler.** Earlier versions had a separate Opus-driven
  planning step. With deterministic branch naming on the host, host-side dep
  filtering, and the explicit decision to leave implicit-conflict detection
  out of scope, the planner had no remaining job.

## Related files

- `.sandcastle/main.ts` — the orchestration loop
- `.sandcastle/implement-prompt.md` — implementer agent prompt
- `.sandcastle/review-prompt.md` — reviewer agent prompt (1-iteration cap)
- `.sandcastle/respond-to-feedback-prompt.md` — addresser agent prompt
- `.sandcastle/CODING_STANDARDS.md` — standards the agents are expected to follow
- `.sandcastle/Dockerfile` — sandbox image

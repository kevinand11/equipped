# TASK

Address the review feedback on PR #{{PR_NUMBER}}. You are on branch `{{BRANCH}}`.

The PR has been flagged with the `needs-revision` label by a human reviewer. Their feedback lives in PR comments (top-level and inline) — those comments are the source of truth for what needs to change. GitHub does not allow PR authors to formally request changes on their own PR, so a label + comments is the trigger here, not a `CHANGES_REQUESTED` review.

# CONTEXT

## PR overview

!`gh pr view {{PR_NUMBER}} --json number,title,body,state,headRefName,baseRefName,url,reviews,latestReviews`

## Top-level review comments

!`gh pr view {{PR_NUMBER}} --comments`

## Inline review comments (file/line specific)

!`gh api repos/{owner}/{repo}/pulls/{{PR_NUMBER}}/comments --paginate`

## Diff being reviewed

!`gh pr diff {{PR_NUMBER}}`

# REVIEW PROCESS

1. **Read every unresolved review comment carefully** — top-level (PR conversation) and inline (file/line specific). Each one is feedback you must address.

2. **For each comment, decide one of:**
   - **Make the change** — update the code in the way the reviewer asked.
   - **Push back with reasoning** — only when you genuinely disagree. Reply with a clear, brief justification. Do not push back to avoid work.

3. **Group related comments.** If two reviewers asked the same thing, fix it once.

4. **Follow the project's coding standards** at @.sandcastle/CODING_STANDARDS.md when implementing changes.

# EXECUTION

1. Make the changes directly on this branch (`{{BRANCH}}`).
2. Run `pnpm run prebuild` (typecheck via `tsc --noEmit`) and `pnpm test` (vitest) to verify nothing broke.
3. Commit with a message that names the feedback you addressed, e.g. `address review: rename foo → bar; tighten input validation`.
4. For each comment thread you addressed, post a brief reply on that thread describing what you did, using:
   `gh api repos/{owner}/{repo}/pulls/{{PR_NUMBER}}/comments/<comment_id>/replies -f body="..."`
   (Replies are optional but help the human reviewer scan progress quickly.)

Do not push from inside the sandbox — the host-side script handles `git push` after this run completes.

Once you've addressed every actionable comment (or replied with reasoning where you disagree), output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY work on this PR's feedback. Do not start new work. Do not modify unrelated files.

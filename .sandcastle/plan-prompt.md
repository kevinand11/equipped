# ISSUES

The host has already fetched the open issues for `{{FEATURE}}` and filtered out anything whose explicit `Depends on #N` / `Blocked by #N` deps are not yet closed. The list below is the surviving candidate set:

<issues-json>
{{ISSUES_JSON}}
</issues-json>

# TASK

Analyze the candidates above and build a heuristic dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other issue in the list.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other issues in the list.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

> Note: explicit `Depends on #N` trailers have already been resolved by the host before you see this list — issues whose explicit deps are still open were dropped. Your job is the *heuristic* layer (overlapping files, decision-shape ordering) on top of that.

## Feature labels

The host's gh query already restricts the list to those carrying the `{{FEATURE}}` label. For each unblocked issue, list every label on it that matches the `feature/*` pattern in a `featureLabels` array — do not default, filter, or omit issues based on this. The host script validates the array and will halt with a loud error if it does not contain exactly the `{{FEATURE}}` label.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags. Each issue must have `id`, `title`, `branch`, and `featureLabels`:

<plan>
{"issues": [
  {"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug", "featureLabels": ["feature/auth-rewrite"]},
  {"id": "43", "title": "Add OAuth provider", "branch": "sandcastle/issue-43-add-oauth-provider", "featureLabels": ["feature/auth-rewrite"]}
]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

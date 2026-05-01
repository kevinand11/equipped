# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --search 'label:Sandcastle -label:in-pr' --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

## Feature labels

For each unblocked issue, list every label on it that matches the `feature/*` pattern in a `featureLabels` array. Do **not** default, filter, or omit issues based on this — emit every unblocked issue with whatever `feature/*` labels it has (zero, one, or many). The host script validates the array and will halt with a loud error if the count is not exactly one. Your job here is to report, not to filter.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags. Each issue must have `id`, `title`, `branch`, and `featureLabels`:

<plan>
{"issues": [
  {"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug", "featureLabels": ["feature/auth-rewrite"]},
  {"id": "43", "title": "Add OAuth provider", "branch": "sandcastle/issue-43-add-oauth-provider", "featureLabels": ["feature/auth-rewrite"]}
]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

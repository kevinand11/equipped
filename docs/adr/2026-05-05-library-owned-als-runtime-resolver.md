# Library-owned ALS for `repo.resolve`; remove `.context`

The `.context(source)` builder step on Repo (which let users plug in a
`ContextSource` with their own scope-entry mechanism) is removed. The
`repo.resolve(transform, fn)` runtime override becomes the sole per-query
config-transform mechanism, and is backed by `AsyncLocalStorage` internally
so concurrent async chains see their own scopes. This collapses the previous
three-layer config pipeline (base resolver + ContextSource transform + runtime
resolver stack) into two (base resolver + ALS-scoped transform stack), and
eliminates the silent concurrency race in today's instance-array-backed
`#resolverStack`.

## Considered Options

- **Keep both `.context(source)` and `repo.resolve(transform, fn)`.** Rejected:
  two mechanisms with overlapping responsibilities invite cargo-culted
  "which do I use?" decisions; canonical use cases (tenant scoping) can be
  expressed through `repo.resolve` from middleware just as cleanly.
- **Pass a scoped Repo to the callback** (`repo.resolve(t, async (scopedRepo) => ...)`).
  No shared mutable state; no ALS in the framework. Rejected: every handler
  inside the scope would have to receive and use the scoped repo instead of
  the module-imported one — friction at every call site, and the
  call-it-as-middleware ergonomic is the whole point of the feature.
- **Document the concurrency limitation and keep the plain instance-array
  stack.** Rejected: races silently corrupt config under concurrent use; this
  is exactly the foot-loaded-gun the original zero-ALS rule existed to keep
  away from users — having the library itself shoot it is worse.

## Consequences

- The **zero-ALS rule** (previously cross-cutting principle #13.8) is removed.
  The library now imports `node:async_hooks` for `repo.resolve` scoping —
  config-only; adapters still own their own tx-context propagation.
- The **adapter-owned tx propagation rule** (now principle #13.8) survives,
  but its rationale narrows: it's no longer "to keep `node:async_hooks` out
  of the framework," it's "tx semantics genuinely differ per adapter (PG
  savepoints, Mongo subtransactions, edge tx-per-request) and the framework
  has no business dictating the mechanism."
- Runtime portability: ALS is available on Node, Bun, Deno, Cloudflare Workers
  (with `nodejs_compat`), and Vercel Edge. Targets without ALS are now out of
  scope for the framework's own scope use.
- `ContextSource<C>` type and the `.context(source)` builder step are deleted.
  Existing tests using `.context(...)` migrate to wrapping the test body in
  `repo.resolve(transform, async () => ...)`.

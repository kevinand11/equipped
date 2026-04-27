# Repo Builder Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor repo builder internals into immutable state plus executor modules while preserving the current fluent API and runtime behavior.

**Architecture:** Keep public builder entrypoints and chaining API as-is, but move behavior into focused internal modules: state transitions, selection/computed shaping, and operation executors. The refactor is phase-based and test-first so behavior remains stable at every commit.

**Tech Stack:** TypeScript, Vitest, valleyed, existing ORM adapter interfaces.

---

## File Structure And Responsibilities

- Modify: `src/orm/repo/builders.ts`
  - Keep public builder classes and method signatures.
  - Delegate state transitions and run logic to internal modules.
- Modify: `src/orm/repo/index.ts`
  - Keep public exports unchanged.
- Create: `src/orm/repo/internal/state.ts`
  - Immutable read/write/filter state types and transition helpers.
- Create: `src/orm/repo/internal/query-spec.ts`
  - Query factory conversion helpers (`toQuerySpec`, read options assembly).
- Create: `src/orm/repo/internal/selection-planner.ts`
  - Build select plan for persisted and computed fields.
- Create: `src/orm/repo/internal/computed-projector.ts`
  - Apply computed fields and final row shaping.
- Create: `src/orm/repo/internal/preload-resolver.ts`
  - Thin wrapper over preloads resolver integration.
- Create: `src/orm/repo/internal/executors/read-executor.ts`
  - One/all read execution orchestration.
- Create: `src/orm/repo/internal/executors/write-executor.ts`
  - Insert/update/upsert/delete execution orchestration.
- Create: `src/orm/repo/internal/validation-gateway.ts`
  - Centralized insert/update validation functions.
- Create: `src/orm/repo/internal/__tests__/state.test.ts`
- Create: `src/orm/repo/internal/__tests__/selection.test.ts`
- Create: `src/orm/repo/internal/__tests__/executors.test.ts`
- Modify: `src/orm/repo/repo.ts`
  - Keep behavior, optionally trim inline tests only after parity is established.

---

### Task 1: Lock Behavior With Regression And Immutability Tests

**Files:**
- Create: `src/orm/repo/internal/__tests__/state.test.ts`
- Modify: `src/orm/repo/repo.ts`
- Test: `src/orm/repo/repo.ts`, `src/orm/repo/internal/__tests__/state.test.ts`

- [ ] **Step 1: Write failing immutability tests for builder chain snapshots**

```ts
import { describe, expect, test } from 'vitest'
// Build a query, branch it, and ensure previous branch is unchanged.

test('builder snapshots are immutable across chain branches', async () => {
  const repo = makeRepo()
  const base = repo.from(UserSchema).all()
  const branchA = base.where((q) => q.eq('name', 'Alice')).select(['id'])
  const branchB = base.where((q) => q.eq('name', 'Bob')).select(['name'])

  const rowsA = await branchA.run()
  const rowsB = await branchB.run()

  expect(rowsA.every((r) => 'id' in r)).toBe(true)
  expect(rowsB.every((r) => 'name' in r)).toBe(true)
})
```

- [ ] **Step 2: Run test to verify failure with current mutable internals**

Run: `pnpm vitest run src/orm/repo/repo.ts src/orm/repo/internal/__tests__/state.test.ts`
Expected: FAIL on branch immutability assertions.

- [ ] **Step 3: Add baseline guard tests for computed field and preload behavior**

```ts
test('computed selection still includes dependency fields for adapter reads', async () => {
  // assert adapter options.select contains computed deps
})

test('mutation with preload still resolves nested relation', async () => {
  // assert insert/update/delete preload behavior remains identical
})
```

- [ ] **Step 4: Re-run full repo behavior contract tests**

Run: `pnpm vitest run src/orm/repo/repo.ts src/orm/repo/preloads.ts`
Expected: PASS except newly added immutability tests.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/repo.ts src/orm/repo/internal/__tests__/state.test.ts
git commit -m "test(repo): add immutability and contract guards for builder refactor"
```

### Task 2: Extract Selection, Computed Projection, And Preload Components

**Files:**
- Create: `src/orm/repo/internal/selection-planner.ts`
- Create: `src/orm/repo/internal/computed-projector.ts`
- Create: `src/orm/repo/internal/preload-resolver.ts`
- Modify: `src/orm/repo/builders.ts`
- Create: `src/orm/repo/internal/__tests__/selection.test.ts`
- Test: `src/orm/repo/internal/__tests__/selection.test.ts`, `src/orm/repo/repo.ts`

- [ ] **Step 1: Write failing unit tests for selection planning and computed projection**

```ts
test('selection planner throws on unknown selected field', () => {
  expect(() => planSelection(schema, ['unknown'])).toThrow('Unknown selected field')
})

test('computed projector throws when dependency missing in adapter row', () => {
  expect(() => applyComputedSelection(schema, [{ firstName: 'Ada' }], plan)).toThrow(
    'Computed field dependency missing from adapter result',
  )
})
```

- [ ] **Step 2: Implement planner and projector modules with same error payload shape**

```ts
export function planSelection(schema: AnySchema, select?: readonly string[]): ComputedSelectionPlan {
  // move logic from SchemaContext.planSelection unchanged
}

export function applyComputedSelection(
  schema: AnySchema,
  rows: Record<string, unknown>[],
  plan: ComputedSelectionPlan,
): Record<string, unknown>[] {
  // move logic from SchemaContext.#applySelection unchanged
}
```

- [ ] **Step 3: Wire SchemaContext shape methods to the new modules**

```ts
const plan = planSelection(this.schema, select as readonly string[] | undefined)
const selected = applyComputedSelection(this.schema, rows, plan)
const resolved = await resolveRowsPreloads(selected, preloads, this.getUse)
```

- [ ] **Step 4: Run tests and verify parity**

Run: `pnpm vitest run src/orm/repo/internal/__tests__/selection.test.ts src/orm/repo/repo.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/internal/selection-planner.ts src/orm/repo/internal/computed-projector.ts src/orm/repo/internal/preload-resolver.ts src/orm/repo/internal/__tests__/selection.test.ts
git commit -m "refactor(repo): extract selection and computed shaping components"
```

### Task 3: Introduce Immutable Builder State Helpers

**Files:**
- Create: `src/orm/repo/internal/state.ts`
- Create: `src/orm/repo/internal/query-spec.ts`
- Modify: `src/orm/repo/builders.ts`
- Modify: `src/orm/repo/internal/__tests__/state.test.ts`
- Test: `src/orm/repo/internal/__tests__/state.test.ts`, `src/orm/repo/repo.ts`

- [ ] **Step 1: Write failing tests for pure state transitions**

```ts
test('addWhere returns new array and keeps old state unchanged', () => {
  const base = createReadState()
  const next = addWhere(base, whereFn)
  expect(next.whereFactories).toHaveLength(1)
  expect(base.whereFactories).toHaveLength(0)
})
```

- [ ] **Step 2: Implement state module with pure transition functions**

```ts
export function addWhere<S extends BaseFilterState>(state: S, factory: WhereFactory): S {
  return { ...state, whereFactories: [...state.whereFactories, factory] }
}

export function setSelect<S extends BaseSelectState, Sel extends string>(state: S, select: readonly Sel[]) {
  return { ...state, select: [...select] }
}
```

- [ ] **Step 3: Replace in-place mutation in builders where/orderBy/limit/offset/id**

```ts
where(factory: WhereFactory): this {
  this._state = addWhere(this._state, factory)
  return this
}
```

```ts
id(value: SchemaPrimaryKeyValue<S>): this {
  this._state = addWhere(this._state, (q) => q.eq(this._context.schema.pkField, value))
  return this
}
```

- [ ] **Step 4: Run tests and ensure immutability tests now pass**

Run: `pnpm vitest run src/orm/repo/internal/__tests__/state.test.ts src/orm/repo/repo.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/internal/state.ts src/orm/repo/internal/query-spec.ts src/orm/repo/internal/__tests__/state.test.ts
git commit -m "refactor(repo): switch builder internals to immutable state transitions"
```

### Task 4: Extract Read Execution Pipeline

**Files:**
- Create: `src/orm/repo/internal/executors/read-executor.ts`
- Modify: `src/orm/repo/builders.ts`
- Create: `src/orm/repo/internal/__tests__/executors.test.ts`
- Test: `src/orm/repo/internal/__tests__/executors.test.ts`, `src/orm/repo/repo.ts`

- [ ] **Step 1: Write failing tests for read executor one/all paths**

```ts
test('read executor one returns null when adapter returns null', async () => {
  await expect(runOneRead(ctx, state)).resolves.toBeNull()
})

test('read executor all uses adapter select from planner', async () => {
  await runAllRead(ctx, state)
  expect(seenSelect).toEqual(expect.arrayContaining(['firstName', 'lastName']))
})
```

- [ ] **Step 2: Implement read executor module**

```ts
export async function runOneRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
  context: SchemaContext<S>,
  state: ReadRunState<Sel, P>,
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
  const row = await context.use.findOne(toQuerySpec(state.whereFactories))
  return context.shapeOneRow(state.select, state.preloads, row)
}
```

- [ ] **Step 3: Delegate OneBuilder.run and AllBuilder.run to read executor**

```ts
async run() {
  return runAllRead(this._context, this._state)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/orm/repo/internal/__tests__/executors.test.ts src/orm/repo/repo.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/internal/executors/read-executor.ts src/orm/repo/internal/__tests__/executors.test.ts
git commit -m "refactor(repo): route read builders through read executor"
```

### Task 5: Extract Write Execution And Validation Gateway

**Files:**
- Create: `src/orm/repo/internal/executors/write-executor.ts`
- Create: `src/orm/repo/internal/validation-gateway.ts`
- Modify: `src/orm/repo/builders.ts`
- Modify: `src/orm/repo/internal/__tests__/executors.test.ts`
- Test: `src/orm/repo/internal/__tests__/executors.test.ts`, `src/orm/repo/repo.ts`, `src/orm/repo/preloads.ts`

- [ ] **Step 1: Write failing tests for insert/update/upsert/delete executor parity**

```ts
test('upsert executor validates insert and optional update before adapter call', async () => {
  await runOneUpsert(context, state)
  expect(validateInsertSpy).toHaveBeenCalledTimes(1)
})

test('delete executor still shapes selected fields with preloads', async () => {
  const row = await runOneDelete(context, state)
  expect(row).toEqual({ id: expect.any(String) })
})
```

- [ ] **Step 2: Implement validation gateway**

```ts
export function validateInsertInput<S extends AnySchema>(schema: S, data: SchemaInsertInput<S>) {
  return validateInsert(schema, data as any)
}

export function validateUpdateInput<S extends AnySchema>(schema: S, data: SchemaUpdateInput<S>) {
  return validateUpdate(schema, data)
}
```

- [ ] **Step 3: Implement write executor and delegate all write builders**

```ts
async run() {
  return runAllUpdate(this._context, this._state, this.#data)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/orm/repo/internal/__tests__/executors.test.ts src/orm/repo/repo.ts src/orm/repo/preloads.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/internal/executors/write-executor.ts src/orm/repo/internal/validation-gateway.ts src/orm/repo/internal/__tests__/executors.test.ts
git commit -m "refactor(repo): route write builders through write executor and validation gateway"
```

### Task 6: Remove Runtime Fragility And Reduce Unsafe Casting

**Files:**
- Modify: `src/orm/repo/builders.ts`
- Modify: `src/orm/repo/internal/state.ts`
- Modify: `src/orm/repo/internal/executors/read-executor.ts`
- Modify: `src/orm/repo/internal/executors/write-executor.ts`
- Test: `src/orm/repo/repo.ts`, `src/orm/repo/preloads.ts`

- [ ] **Step 1: Write failing type-level checks for builder transitions**

```ts
// compile-time assertions with ts-expect-error for invalid selections
// and inferred type checks for valid selections/preloads.
```

- [ ] **Step 2: Replace placeholder runtime clone implementation with typed abstract contract**

```ts
protected abstract _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(
  next: WriteState<NewSel, NewP>,
): WriteBuilderFor<this, S, NewSel, NewP>
```

- [ ] **Step 3: Replace avoidable any casts in run and clone paths**

```ts
const row = await this._context.use.insertOne(validated)
return (await this._shapeOneRow(row)) as SelectedWithPreloads<S, Sel, P>
```

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm tsc -p tsconfig.json --noEmit`
Expected: PASS.

Run: `pnpm vitest run src/orm/repo/repo.ts src/orm/repo/preloads.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/internal/state.ts src/orm/repo/internal/executors/read-executor.ts src/orm/repo/internal/executors/write-executor.ts
git commit -m "refactor(repo): tighten builder types and remove runtime fragility"
```

### Task 7: Final Verification And Cleanup

**Files:**
- Modify: `src/orm/repo/index.ts` (if export adjustments are needed)
- Modify: `README.md` (only if internal architecture notes are documented)
- Test: full repo package tests

- [ ] **Step 1: Run targeted repo suite**

Run: `pnpm vitest run src/orm/repo/repo.ts src/orm/repo/preloads.ts src/orm/repo/internal/__tests__/state.test.ts src/orm/repo/internal/__tests__/selection.test.ts src/orm/repo/internal/__tests__/executors.test.ts`
Expected: PASS.

- [ ] **Step 2: Run package test command**

Run: `pnpm test`
Expected: PASS for equipped package test suite.

- [ ] **Step 3: Run lint and typecheck**

Run: `pnpm lint && pnpm tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify no public API break in exports**

Run: `pnpm vitest run src/orm/repo/repo.ts`
Expected: PASS for fluent API usage.

- [ ] **Step 5: Final commit**

```bash
git add src/orm/repo/builders.ts src/orm/repo/index.ts src/orm/repo/internal README.md
git commit -m "refactor(repo): complete builder architecture cleanup with behavior parity"
```

---

## Self-Review Checklist

- Spec coverage: All requested areas are represented: immutable builders, modular structure, executor extraction, reduced unsafe typing, behavior parity.
- Placeholder scan: No TODO/TBD steps or unresolved references remain.
- Type consistency: Uses the same state, executor, and selected-with-preloads naming across tasks.

## Rollback Strategy

- If any phase introduces behavioral regression, revert only the latest commit in this sequence and continue from last green commit.
- Keep each task isolated to one responsibility so rollback remains low-risk.

# PIN Capability/Discoverability Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `ProtocolInterfaceNode` into bare-capability interfaces, a `NodeStatus` discoverability base, and per-verb discoverable node types, so a receive-only node wires into a `Rig` with zero read/observe stubs — while every existing full-PIN client keeps compiling and running unchanged.

**Architecture:** Additive type family in `src/types/types.ts` (`ProtocolInterfaceNode` recomposed via `extends`, identical structural shape). `Connection`/`connection` become generic with default `ProtocolInterfaceNode`. `RigRoutes` verbs narrow to `Connection<Protocol{Verb}Node>[]`, and `rig.ts` narrows its internal route-storage fields to match. Backward compatibility rests on `Connection`'s `client` field being covariant: a full-PIN connection satisfies every narrowed slot.

**Tech Stack:** Deno, TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), `@std/assert`, `Deno.test`.

## Global Constraints

- **Deno-first.** Use `deno task check` and `deno task test`; do not introduce Node tooling.
- `deno task check` = `deno check mod.ts src/rig/mod.ts`. Test files are type-checked by `deno test` (which type-checks before running), not by `check`.
- `deno task test` = `deno test --allow-all src/`.
- **strict mode is on** with `noUnusedLocals` and `noUnusedParameters`: every local and parameter in every file (tests included) must be referenced. Type-fixture bindings must be consumed (e.g. pushed into an array that a runtime assertion walks). Underscore-prefixed locals are **not** exempt from `noUnusedLocals` — only unused *parameters* are exempt when `_`-prefixed. Exported top-level consts are not flagged.
- **Cores stay puritan.** No new defaults, coercion, or auto-wiring. This change only splits types and narrows route typing.
- **`ProtocolInterfaceNode` name and structural shape are frozen.** It must remain `{ receive, read, observe, status }` structurally so all 22 existing importers are unaffected.
- Commit style: conventional commits (e.g. `refactor(core): …`, `test(core): …`), matching recent history.
- Work happens on branch `refactor/pin-capability-split` (already created; the design spec is already committed there).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/types.ts` | The interface family | Replace the single `ProtocolInterfaceNode` interface (lines ~176–271) with 3 bare-capability interfaces + `NodeStatus` + 3 capability-node interfaces + recomposed `ProtocolInterfaceNode`. Migrate the per-method JSDoc onto the capability interfaces. |
| `src/types/pin-family.test.ts` | Prove the family composes and PIN is unchanged | New (Task 1). |
| `mod.ts` | Public export surface | Add 7 new type exports (Task 1). |
| `src/rig/connection.ts` | Client + pattern binding | Make `Connection<T>` and `connection<T>` generic, default `ProtocolInterfaceNode` (Task 2). |
| `src/rig/types.ts` | `RigRoutes` / `RigConfig` | Narrow `RigRoutes` verbs to per-verb node types (Task 3). |
| `src/rig/rig.ts` | Orchestration + dispatch | Narrow `_receiveRoutes`/`_readRoutes`/`_observeRoutes` fields, `createRouteDispatch` param, and the `status()` aggregation collection type (Task 3). |
| `src/rig/pin-split.test.ts` | Prove receive-only wiring works, read-wiring is a type error, full node still wires everywhere, `status()` still aggregates (Task 3). | New (Task 3). |

---

## Task 1: Interface family in `types.ts` + exports

**Files:**
- Modify: `src/types/types.ts` (replace the `ProtocolInterfaceNode` block, ~lines 176–271)
- Modify: `mod.ts` (add 7 type exports to the `export type { … } from "./src/types/types.ts"` block, ~lines 12–26)
- Test: `src/types/pin-family.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface ProtocolReceive { receive(msgs: Output[]): PromiseLike<ReceiveResult[]> }`
  - `interface ProtocolRead { read<T = unknown>(locators: string[]): Promise<Output<T>[]> }`
  - `interface ProtocolObserve { observe(locators: string[], signal: AbortSignal): AsyncIterable<readonly string[]> }`
  - `interface NodeStatus { status(): Promise<StatusResult> }`
  - `interface ProtocolReceiveNode extends ProtocolReceive, NodeStatus {}`
  - `interface ProtocolReadNode extends ProtocolRead, NodeStatus {}`
  - `interface ProtocolObserveNode extends ProtocolObserve, NodeStatus {}`
  - `interface ProtocolInterfaceNode extends ProtocolReceive, ProtocolRead, ProtocolObserve, NodeStatus {}` (name + shape unchanged)

- [ ] **Step 1: Write the failing test**

Create `src/types/pin-family.test.ts`:

```ts
/**
 * PIN family composition — compile-time assertions that
 * `ProtocolInterfaceNode` is assignable to each capability and node
 * type. If any type is missing or mis-composed, `deno test` fails to
 * type-check this file.
 */

import { assertEquals } from "@std/assert";
import type {
  NodeStatus,
  ProtocolInterfaceNode,
  ProtocolObserve,
  ProtocolObserveNode,
  ProtocolRead,
  ProtocolReadNode,
  ProtocolReceive,
  ProtocolReceiveNode,
} from "./types.ts";

// Each arrow asserts `ProtocolInterfaceNode <: <Target>` at compile time.
const asReceive = (n: ProtocolInterfaceNode): ProtocolReceive => n;
const asRead = (n: ProtocolInterfaceNode): ProtocolRead => n;
const asObserve = (n: ProtocolInterfaceNode): ProtocolObserve => n;
const asStatus = (n: ProtocolInterfaceNode): NodeStatus => n;
const asReceiveNode = (n: ProtocolInterfaceNode): ProtocolReceiveNode => n;
const asReadNode = (n: ProtocolInterfaceNode): ProtocolReadNode => n;
const asObserveNode = (n: ProtocolInterfaceNode): ProtocolObserveNode => n;

Deno.test("ProtocolInterfaceNode composes from the capability/node family", () => {
  // Referencing every binding satisfies noUnusedLocals; the real
  // assertions are the return-type annotations above.
  const family = [
    asReceive,
    asRead,
    asObserve,
    asStatus,
    asReceiveNode,
    asReadNode,
    asObserveNode,
  ];
  for (const f of family) assertEquals(typeof f, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all src/types/pin-family.test.ts`
Expected: FAIL — type-check error, the imported names (`ProtocolReceive`, `NodeStatus`, `ProtocolReceiveNode`, …) do not exist in `./types.ts`.

- [ ] **Step 3: Implement the family in `types.ts`**

In `src/types/types.ts`, replace the entire existing block that begins with the `/** ProtocolInterfaceNode — the universal interface … */` JSDoc and the `export interface ProtocolInterfaceNode { … }` (through its closing `}`) with:

```ts
/**
 * ProtocolReceive — the receive capability.
 *
 * `receive` is the unified entry point for all state changes. Each
 * output is `[uri, payload]` where `uri` is the canonical resource
 * identifier the payload is written under. Clients interpret the
 * payload per their role (storage clients persist, audit clients
 * append, forwarders forward). Returns one `ReceiveResult` per output.
 *
 * The return type is `PromiseLike` (not `Promise`) so implementations
 * can return richer await-targets — e.g. the Rig returns an
 * `OperationHandle` that is awaitable AND exposes per-route events.
 * Plain `Promise<ReceiveResult[]>` still satisfies the contract.
 */
export interface ProtocolReceive {
  receive(msgs: Output[]): PromiseLike<ReceiveResult[]>;
}

/**
 * ProtocolRead — the read capability.
 *
 * Locators are opaque to the framework: their grammar is a contract
 * between the caller and the executing client. Returns one `Output<T>`
 * per input locator, in input order — each `[inputLocator, payload]`,
 * so results are addressable positionally or by lookup.
 *
 * Payload semantics are entirely the client's concern. What "not
 * found" looks like, what listing shapes look like, what extension
 * functions return — all defined by the executing client and agreed
 * with its callers out-of-band.
 *
 * **Errors:** transport / programmer errors throw (network down, no
 * route accepts, grammar violations the client rejects). Anything else
 * — "not found", auth refusals — is encoded in the payload per the
 * client's convention.
 */
export interface ProtocolRead {
  read<T = unknown>(locators: string[]): Promise<Output<T>[]>;
}

/**
 * ProtocolObserve — the observe capability.
 *
 * Yields INV-style batches of uris that changed under any subscribed
 * pattern. The observer reads each uri to learn its current state.
 * Locators are matched against emitted uris as segment-globs — pure
 * string pattern matching, no grammar awareness. Each yield is a
 * non-empty `readonly string[]` of concrete uris that fired in this
 * batch. The `signal` controls lifecycle — abort to stop observing.
 *
 * @example
 * ```ts
 * const abort = new AbortController();
 * for await (const uris of client.observe(["mutable://market/**"], abort.signal)) {
 *   const outputs = await client.read(uris);
 *   for (const [uri, payload] of outputs) console.log(uri, payload);
 * }
 * ```
 */
export interface ProtocolObserve {
  observe(
    locators: string[],
    signal: AbortSignal,
  ): AsyncIterable<readonly string[]>;
}

/**
 * NodeStatus — the discoverability contract.
 *
 * `status()` is not a fourth capability; it is what makes something a
 * *node* rather than a bare receiving/reading/observing client. Its
 * `resources` payload is the standard discovery surface — identical
 * in-process and over the wire. Every wireable node implements it.
 *
 * Clients report health + capabilities; the rig aggregates and adds
 * schema.
 */
export interface NodeStatus {
  status(): Promise<StatusResult>;
}

/**
 * A discoverable node that receives. The capability every wireable
 * `receive:`-route member must satisfy: `receive` + `status`.
 *
 * **URIs vs locators.** A *uri* is the canonical identifier of a
 * resource — used for writes and emitted on observe so listeners learn
 * which resource changed. A *locator* is any addressing string a
 * caller passes to `read`/`observe`: a bare uri, a pattern with
 * wildcards, or a uri decorated with request-time directives. The
 * framework treats locators as opaque — it routes them by string
 * pattern matching and hands them to the executing client verbatim.
 */
export interface ProtocolReceiveNode extends ProtocolReceive, NodeStatus {}

/** A discoverable node that reads: `read` + `status`. */
export interface ProtocolReadNode extends ProtocolRead, NodeStatus {}

/** A discoverable node that observes: `observe` + `status`. */
export interface ProtocolObserveNode extends ProtocolObserve, NodeStatus {}

/**
 * ProtocolInterfaceNode (PIN) — the full node: all three capabilities
 * plus discoverability. The canonical interface implemented by clients
 * that serve every verb (Memory, HTTP, WebSocket, Postgres, IndexedDB,
 * the Rig itself, …), enabling recursive composition and uniform usage.
 *
 * Structurally identical to the pre-split interface — `{ receive, read,
 * observe, status }` — so it remains a drop-in for every existing
 * implementer and consumer.
 */
export interface ProtocolInterfaceNode
  extends ProtocolReceive, ProtocolRead, ProtocolObserve, NodeStatus {}
```

- [ ] **Step 4: Add the exports in `mod.ts`**

In `mod.ts`, inside the `export type { … } from "./src/types/types.ts";` block (currently listing `ProtocolInterfaceNode`), add the seven new names so the block reads (alphabetical insertion is fine; keep `ProtocolInterfaceNode`):

```ts
export type {
  B3ndError,
  ClientError,
  CodeHandler,
  DeleteResult,
  HealthStatus,
  NodeStatus,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ProtocolObserve,
  ProtocolObserveNode,
  ProtocolRead,
  ProtocolReadNode,
  ProtocolReceive,
  ProtocolReceiveNode,
  ReadFn,
  ReceiveResult,
  StatusResult,
  WriteResult,
} from "./src/types/types.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all src/types/pin-family.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Verify the whole package still type-checks and tests green**

Run: `deno task check`
Expected: no errors.
Run: `deno task test`
Expected: all tests pass (the shape of `ProtocolInterfaceNode` is unchanged, so nothing else moves).

- [ ] **Step 7: Commit**

```bash
git add src/types/types.ts src/types/pin-family.test.ts mod.ts
git commit -m "refactor(core): split PIN into capability + NodeStatus family"
```

---

## Task 2: Generic `Connection<T>` / `connection<T>`

**Files:**
- Modify: `src/rig/connection.ts` (the `Connection` interface + `connection` function signature)
- Test: covered by `deno task check` + Task 3's `pin-split.test.ts` (no standalone `connection.test.ts` exists; do not invent one)

**Interfaces:**
- Consumes: `ProtocolInterfaceNode` from `../types/types.ts` (already imported in this file).
- Produces:
  - `interface Connection<T = ProtocolInterfaceNode> { readonly id: string; readonly client: T; readonly patterns: readonly string[]; accepts(uri: string): boolean }`
  - `function connection<T = ProtocolInterfaceNode>(client: T, patterns: string[], options?: ConnectionOptions): Connection<T>`

- [ ] **Step 1: Make the `Connection` interface generic**

In `src/rig/connection.ts`, change the interface declaration. Replace:

```ts
/** A connection: a client wrapped with a URI pattern list. */
export interface Connection {
  /** Stable identifier (provided or auto-generated). */
  readonly id: string;

  /** The underlying client. */
  readonly client: ProtocolInterfaceNode;

  /**
   * The raw patterns — serializable for wire protocols.
   * Send this to a remote node so it knows what to push.
   */
  readonly patterns: readonly string[];

  /** Check if this connection's pattern list accepts a URI. */
  accepts(uri: string): boolean;
}
```

with:

```ts
/**
 * A connection: a client wrapped with a URI pattern list.
 *
 * Generic over the client's node type. Defaults to
 * `ProtocolInterfaceNode` so bare `Connection` keeps meaning "full
 * node", but a narrower client (e.g. a receive-only node) is preserved
 * as `Connection<{ receive; status }>` — which the rig's per-verb route
 * slots use to reject mis-wiring at compile time.
 */
export interface Connection<T = ProtocolInterfaceNode> {
  /** Stable identifier (provided or auto-generated). */
  readonly id: string;

  /** The underlying client. */
  readonly client: T;

  /**
   * The raw patterns — serializable for wire protocols.
   * Send this to a remote node so it knows what to push.
   */
  readonly patterns: readonly string[];

  /** Check if this connection's pattern list accepts a URI. */
  accepts(uri: string): boolean;
}
```

- [ ] **Step 2: Make the `connection` function generic**

In the same file, change the function signature. Replace:

```ts
export function connection(
  client: ProtocolInterfaceNode,
  patterns: string[],
  options?: ConnectionOptions,
): Connection {
```

with:

```ts
export function connection<T = ProtocolInterfaceNode>(
  client: T,
  patterns: string[],
  options?: ConnectionOptions,
): Connection<T> {
```

Leave the function body unchanged — it never touches `client` beyond storing it.

- [ ] **Step 3: Verify the package still type-checks and tests green**

Run: `deno task check`
Expected: no errors. (Bare `Connection` still resolves to `Connection<ProtocolInterfaceNode>` via the default; existing `connection(client, …)` calls infer a `T` that is `<: ProtocolInterfaceNode`, and `Connection<T>` is covariantly assignable to `Connection<ProtocolInterfaceNode>` wherever the rig currently expects it.)
Run: `deno task test`
Expected: all tests pass, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/rig/connection.ts
git commit -m "refactor(rig): make Connection/connection generic over node type"
```

---

## Task 3: Per-verb route typing + rig narrowing

**Files:**
- Modify: `src/rig/types.ts` (`RigRoutes`)
- Modify: `src/rig/rig.ts` (route-storage fields, `createRouteDispatch` param, `status()` aggregation type)
- Test: `src/rig/pin-split.test.ts` (create)

**Interfaces:**
- Consumes: `ProtocolReceiveNode` / `ProtocolReadNode` / `ProtocolObserveNode` / `NodeStatus` from `../types/types.ts`; generic `Connection<T>` + `connection<T>` from `./connection.ts`.
- Produces:
  - `interface RigRoutes { receive?: Connection<ProtocolReceiveNode>[]; read?: Connection<ProtocolReadNode>[]; observe?: Connection<ProtocolObserveNode>[] }`

- [ ] **Step 1: Write the failing test**

Create `src/rig/pin-split.test.ts`:

```ts
/**
 * Wire-level assertions for the capability/discoverability split:
 *  - a genuinely receive-only node ({ receive, status }) wires into
 *    routes.receive and works at runtime;
 *  - status() still aggregates when only a receive node is wired;
 *  - the same node is NOT assignable to a read route (compile error);
 *  - a full node (the Rig itself) still wires into all three routes.
 */

import { assertEquals } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection, type Connection } from "./connection.ts";
import type {
  Output,
  ProtocolReadNode,
  ProtocolReceiveNode,
  ReceiveResult,
  StatusResult,
} from "../types/types.ts";

// A genuinely receive-only node: `receive` + `status`, nothing else.
const receiver: ProtocolReceiveNode = {
  receive: (msgs: Output[]): Promise<ReceiveResult[]> =>
    Promise.resolve(msgs.map(() => ({ accepted: true }))),
  status: (): Promise<StatusResult> => Promise.resolve({ status: "healthy" }),
};

Deno.test("receive-only node wires into routes.receive and accepts", async () => {
  const rig = new Rig({ routes: { receive: [connection(receiver, ["**"])] } });
  const [r] = await rig.receive([["mutable://open/x", { v: 1 }]]);
  assertEquals(r.accepted, true);
});

Deno.test("status() aggregates over a receive-only node", async () => {
  const rig = new Rig({ routes: { receive: [connection(receiver, ["**"])] } });
  const s = await rig.status();
  assertEquals(s.status, "healthy");
  assertEquals(s.resources?.receive, ["**"]);
});

// A receive-only node must NOT satisfy a read-node connection. If the
// covariance ever loosened to allow this, the @ts-expect-error becomes
// an "unused directive" error and this file fails to type-check.
// @ts-expect-error — a receive-only node is not a ProtocolReadNode
export const _badReadConn: Connection<ProtocolReadNode> = connection(
  receiver,
  ["**"],
);

Deno.test("full node (Rig) wires into all three routes", () => {
  const inner = new Rig({
    routes: { receive: [connection(receiver, ["**"])] },
  });
  const c = connection(inner, ["**"]);
  const full = new Rig({ routes: { receive: [c], read: [c], observe: [c] } });
  assertEquals(typeof full.status, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all src/rig/pin-split.test.ts`
Expected: FAIL — type-check error on the two `routes: { receive: [connection(receiver, …)] }` lines: `RigRoutes.receive` is still `Connection[]` (= `Connection<ProtocolInterfaceNode>[]`), and `Connection<ProtocolReceiveNode>` is not assignable to it (a receive-only node is not a full PIN).

- [ ] **Step 3: Narrow `RigRoutes` in `src/rig/types.ts`**

Add the node-type imports and retype the verbs. Change the import at the top:

```ts
import type {
  CodeHandler,
  Program,
  ProtocolInterfaceNode,
} from "../types/types.ts";
```

to:

```ts
import type {
  CodeHandler,
  Program,
  ProtocolInterfaceNode,
  ProtocolObserveNode,
  ProtocolReadNode,
  ProtocolReceiveNode,
} from "../types/types.ts";
```

Then replace the `RigRoutes` body:

```ts
export interface RigRoutes {
  receive?: Connection[];
  read?: Connection[];
  observe?: Connection[];
}
```

with:

```ts
export interface RigRoutes {
  receive?: Connection<ProtocolReceiveNode>[];
  read?: Connection<ProtocolReadNode>[];
  observe?: Connection<ProtocolObserveNode>[];
}
```

(`ProtocolInterfaceNode` stays imported — it is still re-exported from this module at line ~18.)

- [ ] **Step 4: Narrow the route storage + dispatch in `src/rig/rig.ts`**

4a. Add the node types to the type import. Change:

```ts
import type {
  CodeHandler,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReceiveResult,
  ResourceCapabilities,
  StatusResult,
} from "../types/types.ts";
```

to add `NodeStatus`, `ProtocolObserveNode`, `ProtocolReadNode`, `ProtocolReceiveNode`:

```ts
import type {
  CodeHandler,
  NodeStatus,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ProtocolObserveNode,
  ProtocolReadNode,
  ProtocolReceiveNode,
  ReceiveResult,
  ResourceCapabilities,
  StatusResult,
} from "../types/types.ts";
```

4b. Narrow the three private route fields. Change:

```ts
  private readonly _receiveRoutes: readonly Connection[];
  private readonly _readRoutes: readonly Connection[];
  private readonly _observeRoutes: readonly Connection[];
```

to:

```ts
  private readonly _receiveRoutes: readonly Connection<ProtocolReceiveNode>[];
  private readonly _readRoutes: readonly Connection<ProtocolReadNode>[];
  private readonly _observeRoutes: readonly Connection<ProtocolObserveNode>[];
```

4c. Narrow `createRouteDispatch`'s parameter type. Change its signature:

```ts
function createRouteDispatch(
  routes: {
    receive: readonly Connection[];
    read: readonly Connection[];
    observe: readonly Connection[];
  },
): ProtocolInterfaceNode {
```

to:

```ts
function createRouteDispatch(
  routes: {
    receive: readonly Connection<ProtocolReceiveNode>[];
    read: readonly Connection<ProtocolReadNode>[];
    observe: readonly Connection<ProtocolObserveNode>[];
  },
): ProtocolInterfaceNode {
```

4d. Narrow the `status()` aggregation collection inside `createRouteDispatch`. Change:

```ts
    async status(): Promise<StatusResult> {
      const seen = new Set<ProtocolInterfaceNode>();
      const unique: ProtocolInterfaceNode[] = [];
```

to (each wired client is guaranteed to carry `status` via `NodeStatus`, and the aggregator only calls `.status()`):

```ts
    async status(): Promise<StatusResult> {
      const seen = new Set<NodeStatus>();
      const unique: NodeStatus[] = [];
```

4e. Narrow `deriveResourcesFromRoutes`'s parameter to match the new field types. Change:

```ts
function deriveResourcesFromRoutes(routes: {
  receive: readonly Connection[];
  read: readonly Connection[];
  observe: readonly Connection[];
}): ResourceCapabilities | undefined {
```

to:

```ts
function deriveResourcesFromRoutes(routes: {
  receive: readonly Connection<ProtocolReceiveNode>[];
  read: readonly Connection<ProtocolReadNode>[];
  observe: readonly Connection<ProtocolObserveNode>[];
}): ResourceCapabilities | undefined {
```

(It only reads `conn.patterns`, so the body is unchanged.)

- [ ] **Step 5: Run the split test to verify it passes**

Run: `deno test --allow-all src/rig/pin-split.test.ts`
Expected: PASS (3 tests; the exported `_badReadConn` type-checks because its `@ts-expect-error` now suppresses a real error).

- [ ] **Step 6: Verify the whole package type-checks and every test is green**

Run: `deno task check`
Expected: no errors. In particular, `(null! as Rig) satisfies ProtocolInterfaceNode` at the bottom of `rig.ts` still holds (Rig implements all four methods), and `get client()` still returns a full `ProtocolInterfaceNode`.
Run: `deno task test`
Expected: all tests pass, including the pre-existing `src/rig/rig.test.ts` (status/resources derivation is unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/rig/types.ts src/rig/rig.ts src/rig/pin-split.test.ts
git commit -m "refactor(rig): per-verb route typing; wire receive-only nodes without stubs"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

- Type family (`ProtocolReceive/Read/Observe`, `NodeStatus`, `Protocol{Verb}Node`, recomposed PIN) → Task 1.
- Doc-comment migration onto capability interfaces → Task 1, Step 3.
- Generic `connection` → Task 2.
- Per-verb `RigRoutes` typing → Task 3, Step 3.
- Internal `rig.ts` narrowing (fields, dispatch param, `status()` collection) → Task 3, Step 4. (Adds `deriveResourcesFromRoutes` param narrowing, which the spec implies under "route-storage narrowing".)
- `mod.ts` seven exports → Task 1, Step 4.
- Backward compatibility (full PIN satisfies every slot; bare `Connection` unchanged) → verified by `deno task check`/`test` green gates in Tasks 1–3, and the "full node wires into all three routes" test in Task 3.
- Testing plan (type-level positive/negative + receive-only runtime + status aggregation) → Task 1 test + Task 3 test.
- Out-of-scope (`FunctionalClient`, `b3nd-move`/`b3nd-save` untouched) → honored; no task modifies them.

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; every code step shows full code and exact commands.

**3. Type consistency** — names used identically across tasks: `NodeStatus`, `ProtocolReceive/Read/Observe`, `ProtocolReceiveNode/ReadNode/ObserveNode`, `ProtocolInterfaceNode`, `Connection<T>`, `connection<T>`, `RigRoutes`, `createRouteDispatch`, `deriveResourcesFromRoutes`, `_receiveRoutes/_readRoutes/_observeRoutes`. Test doubles: `receiver: ProtocolReceiveNode` and the `_badReadConn: Connection<ProtocolReadNode>` fixture are consistent with the family from Task 1.

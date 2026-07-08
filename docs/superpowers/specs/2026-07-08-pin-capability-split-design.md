# Design: Splitting PIN into capability + discoverability interfaces

**Date:** 2026-07-08
**Repo:** `b3nd-core`
**Status:** Approved design, pending implementation plan

## Problem

`ProtocolInterfaceNode` (PIN) bundles four methods — `receive`, `read`,
`observe`, `status` — into one interface that *every* client must implement in
full. But many real nodes serve only one verb: a pure receiver has no meaningful
`read`/`observe`. Today the only way to wire such a node into a `Rig` is to stub
the methods it doesn't serve. `FunctionalClient` exists precisely to paper over
this — it returns `"not implemented"` / `[]` / `{ status: "healthy" }` defaults
for the methods you leave out.

Those stubs are dead surface. They cost authoring effort, they invite the mental
gymnastics of "what does `read` even mean on this node," and they let a
misconfigured topology (a receiver wired into a `read:` route) type-check when it
should not.

The runtime is *already* verb-partitioned: `createRouteDispatch` only calls
`receive` on `receive:`-route connections, `read` on `read:`-route connections,
and `observe` on `observe:`-route connections. The one method called across
*all* wired clients is `status()`. **The type system is the only thing forcing
the stubs.** This design removes that force.

## Guiding distinction

> One thing is a **client that receives** (a bare capability). Another thing is a
> **node** (a discoverable unit). `status()` is not a fourth capability — it is
> what makes something a node at all. Its `resources` payload is the standard
> discovery surface, identical in-process and over the wire.

So: the *capabilities* (`receive` / `read` / `observe`) are what vary per node.
*Discoverability* (`status`) is required of every wireable node. The stubs we
eliminate are the unused capabilities — never `status`.

## The type family (`src/types/types.ts`)

```ts
// ── Bare capability signatures — "a client that receives/reads/observes" ──
export interface ProtocolReceive {
  receive(msgs: Output[]): PromiseLike<ReceiveResult[]>;
}
export interface ProtocolRead {
  read<T = unknown>(locators: string[]): Promise<Output<T>[]>;
}
export interface ProtocolObserve {
  observe(
    locators: string[],
    signal: AbortSignal,
  ): AsyncIterable<readonly string[]>;
}

// ── Discoverability base — what makes something a *node* ──
export interface NodeStatus {
  status(): Promise<StatusResult>;
}

// ── Discoverable capability nodes = capability + discoverability ──
export interface ProtocolReceiveNode extends ProtocolReceive, NodeStatus {}
export interface ProtocolReadNode    extends ProtocolRead,    NodeStatus {}
export interface ProtocolObserveNode extends ProtocolObserve, NodeStatus {}

// ── Full node — unchanged name, now composed from the family ──
export interface ProtocolInterfaceNode
  extends ProtocolReceive, ProtocolRead, ProtocolObserve, NodeStatus {}
```

### Naming rationale

- **The `Node` suffix carries the meaning.** Present = discoverable node (extends
  `NodeStatus`); absent = bare capability. `ProtocolReceive` vs
  `ProtocolReceiveNode` reads as "a receiver" vs "a receiving node" — exactly the
  capability-vs-node distinction above.
- **`NodeStatus` deliberately breaks the `Protocol*` prefix** to signal that it is
  not a peer capability — it is the node-identity facet every node carries.
- **`ProtocolInterfaceNode` keeps its name and structural shape.** It is the
  established "PIN"; renaming it would break the ecosystem and the mental model.
  In the new family it reads as "the node with the whole interface."

### Doc-comment migration

The current per-method JSDoc on `ProtocolInterfaceNode` (the `receive` / `read` /
`observe` / `status` blocks, plus the "URIs vs locators" preamble) moves onto the
bare-capability interfaces and `NodeStatus`. `ProtocolInterfaceNode` keeps a short
comment noting it is the full node — the union of all capabilities plus
discoverability. No documentation is lost.

## Generic `connection` (`src/rig/connection.ts`)

```ts
export interface Connection<T = ProtocolInterfaceNode> {
  readonly id: string;
  readonly client: T;
  readonly patterns: readonly string[];
  accepts(uri: string): boolean;
}

export function connection<T = ProtocolInterfaceNode>(
  client: T,
  patterns: string[],
  options?: ConnectionOptions,
): Connection<T> {
  /* body unchanged */
}
```

Bare `Connection` still resolves to `Connection<ProtocolInterfaceNode>` via the
default type argument, so existing references keep working. `connection(fullPin, …)`
infers `Connection<ProtocolInterfaceNode>`; `connection(myReceiver, …)` where
`myReceiver: { receive, status }` infers `Connection<{ receive, status }>`.

## Per-verb route typing (`src/rig/types.ts`)

```ts
export interface RigRoutes {
  receive?: Connection<ProtocolReceiveNode>[];
  read?:    Connection<ProtocolReadNode>[];
  observe?: Connection<ProtocolObserveNode>[];
}
```

- A full-PIN connection is assignable to **every** slot: `ProtocolInterfaceNode`
  extends each `Protocol{Verb}Node`, and `Connection`'s `client` field is
  covariant. So existing `routes: { receive: [c], read: [c], observe: [c] }` with a
  single full client compiles unchanged.
- A receive-only node (`Connection<{ receive, status }>`) is assignable **only** to
  `receive:`. Putting it in `read:` is a compile error. This is the payoff — the
  topology's verb constraints are now checked at the wiring boundary.

## Internal narrowing (`src/rig/rig.ts`)

- `_receiveRoutes` / `_readRoutes` / `_observeRoutes` fields narrow to
  `readonly Connection<ProtocolReceiveNode>[]` / `…ReadNode` / `…ObserveNode`.
- `createRouteDispatch`'s parameter narrows to the same per-verb node types. Its
  body is unchanged: it already calls each verb only on that verb's route list.
- `status()` aggregation iterates every unique client and calls `.status()`. This
  stays correct with **no runtime guards**, because every route slot carries
  `NodeStatus` — `status` is guaranteed present on every wired client. The `unique`
  collection types as `NodeStatus[]` (it only calls `status`).
- `Rig.client` getter and the closing `(null! as Rig) satisfies
  ProtocolInterfaceNode` assertion are unaffected — `Rig` still implements all four
  methods, so it remains a full node.

## Exports (`mod.ts`)

Add the seven new type exports alongside `ProtocolInterfaceNode` in the
`export type { … } from "./src/types/types.ts"` block:

```ts
ProtocolReceive,
ProtocolRead,
ProtocolObserve,
NodeStatus,
ProtocolReceiveNode,
ProtocolReadNode,
ProtocolObserveNode,
```

`src/rig/types.ts` currently re-exports `ProtocolInterfaceNode` "so app-specific
libs can pull it from the rig module." Leave that single re-export as is; the new
types are pulled from the core types module. (Broadening the rig re-export is
optional polish, out of scope.)

## Out of scope (this pass)

- **`FunctionalClient` stays as-is.** It still implements the full PIN with
  defaults and remains a convenience. It is simply no longer the *required* path —
  you can now hand-write `{ receive, status }` and wire it with zero
  `read`/`observe` stubs. Narrowing or deprecating `FunctionalClient` is a
  follow-up.
- **`b3nd-move` / `b3nd-save` implementers are not touched.** They implement full
  PIN and keep compiling unchanged. Narrowing individual transports/stores to
  their true capability set is future, opt-in work enabled by this change.
- **No new pure-capability convenience aliases** beyond the seven types above.
  `ReceiveFn` already exists for the bare function shape.

## Backward compatibility

1. `ProtocolInterfaceNode`'s structural shape is identical → every existing
   implementer and consumer is unaffected.
2. `Connection` / `connection` default their type parameter to
   `ProtocolInterfaceNode` → bare references resolve as before.
3. Full-PIN connections satisfy every narrowed route slot by covariance →
   existing `Rig` wiring compiles and runs unchanged.

The only *new* capability is that partial nodes are now expressible and
wire-checkable. Nothing that compiles today stops compiling.

## Testing

**Type-level fixtures** (compile-only assertions):

1. A `{ receive, status }` node wires into `routes.receive` — compiles.
2. The same node wired into `routes.read` — `// @ts-expect-error`.
3. A full PIN wires into all three routes — compiles.
4. A `{ read, status }` node wires into `routes.read` but not `routes.receive`.

**Runtime:**

5. Existing `rig` / `connection` / dispatch suites pass unchanged.
6. New test: construct a `Rig` whose `receive:` route holds a genuinely
   receive-only node (no `read`/`observe`), then assert `rig.status()` still
   aggregates health/schema/resources correctly (proves the `status()`-across-all
   path is satisfied by `NodeStatus` alone).

**Full check:** `deno check` and `deno test` clean, no new warnings.

## Files touched

| File | Change |
|---|---|
| `src/types/types.ts` | New interface family; migrate method JSDoc onto capability interfaces; recompose `ProtocolInterfaceNode` via `extends`. |
| `src/rig/connection.ts` | `Connection<T>` and `connection<T>` become generic (default `ProtocolInterfaceNode`). |
| `src/rig/types.ts` | `RigRoutes` verbs typed as `Connection<Protocol{Verb}Node>[]`. |
| `src/rig/rig.ts` | Narrow route-storage fields, `createRouteDispatch` param, and `status()` aggregation collection type. |
| `mod.ts` | Export the six new types. |
| `src/**/*.test.ts` (new fixture) | Type-level + runtime tests above. |

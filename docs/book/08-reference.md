# Chapter 8 — Reference

> The `App` / `composeApps` primitive in full, the exact merge rules, and a
> glossary. Paste the source into your project, or lift it into core.

This is the one piece the book introduces that isn't in core today. It's pure
config algebra over `RigConfig` — no runtime, no I/O — so it can live in your
app, in a shared `chirp-kit` package, or as a `src/app/` module in core.

## The `App` type

```ts
// chirp/app.ts
import type {
  CodeHandler,
  Connection,
  EventHandler,
  HooksConfig,
  Program,
  Reaction,
  RigEventName,
  RigRoutes,
} from "@bandeira-tech/b3nd-core";

/**
 * An App is a named, namespaced slice of rig behavior. It only ever
 * touches the URIs of the Canon(s) it owns. Apps compose into one Rig
 * via `composeApps`.
 */
export interface App {
  name: string;
  routes?: RigRoutes;
  programs?: Record<string, Program>;
  handlers?: Record<string, CodeHandler>;
  reactions?: Record<string, Reaction>;
  hooks?: HooksConfig;
  on?: Partial<Record<RigEventName, EventHandler[]>>;
}

/** Optional helper for inline typing: `defineApp({ name, ... })`. */
export const defineApp = (app: App): App => app;
```

Apps are usually written as **factories** that take their Domain PIN so the
behavior is decoupled from storage:

```ts
export const postsApp = (store: ProtocolInterfaceNode): App => ({ name: "posts", /* … */ });
```

## `composeApps`

```ts
// chirp/app.ts (continued)
import type {
  AfterHook,
  BeforeHook,
  OnErrorHook,
  ReadCtx,
  ReceiveCtx,
  RigConfig,
  SendCtx,
} from "@bandeira-tech/b3nd-core";

/** Run before-hooks in sequence, threading the (rewritable) context. */
function chainBefore<C>(hooks: BeforeHook<C>[]): BeforeHook<C> | undefined {
  if (hooks.length === 0) return undefined;
  return async (ctx) => {
    let current = ctx as C;
    for (const h of hooks) {
      const r = await h(current);
      if (r && typeof r === "object" && "ctx" in r) current = r.ctx;
    }
    return { ctx: current };
  };
}

/** Run every after-hook; any throw enforces a post-condition. */
function chainAfter<C>(hooks: AfterHook<C>[]): AfterHook<C> | undefined {
  if (hooks.length === 0) return undefined;
  return async (ctx, result) => {
    for (const h of hooks) await h(ctx, result);
  };
}

/** Run every onError hook; any throw aborts the operation. */
function chainOnError(hooks: OnErrorHook[]): OnErrorHook | undefined {
  if (hooks.length === 0) return undefined;
  return async (ctx) => {
    for (const h of hooks) await h(ctx);
  };
}

/**
 * Merge Apps into a single RigConfig.
 *
 * - routes:    concatenated per op, in App order (read = first-match-wins).
 * - programs / handlers / reactions: key-merged; DUPLICATE KEY THROWS.
 * - on (events): concatenated per event name.
 * - hooks:     chained per slot (before: sequential + rewrites; after &
 *              onError: all run).
 */
export function composeApps(apps: App[]): RigConfig {
  const routes = {
    receive: [] as Connection[],
    read: [] as Connection[],
    observe: [] as Connection[],
  };
  const programs: Record<string, Program> = {};
  const handlers: Record<string, CodeHandler> = {};
  const reactions: Record<string, Reaction> = {};
  const on: Partial<Record<RigEventName, EventHandler[]>> = {};

  const before = {
    send: [] as BeforeHook<SendCtx>[],
    receive: [] as BeforeHook<ReceiveCtx>[],
    read: [] as BeforeHook<ReadCtx>[],
  };
  const after = {
    send: [] as AfterHook<SendCtx>[],
    receive: [] as AfterHook<ReceiveCtx>[],
    read: [] as AfterHook<ReadCtx>[],
  };
  const onError: OnErrorHook[] = [];

  const claim = <V>(
    map: Record<string, V>,
    key: string,
    value: V,
    kind: string,
    app: App,
  ) => {
    if (key in map) {
      throw new Error(
        `composeApps: ${kind} "${key}" claimed by two apps (offending: "${app.name}")`,
      );
    }
    map[key] = value;
  };

  for (const app of apps) {
    routes.receive.push(...(app.routes?.receive ?? []));
    routes.read.push(...(app.routes?.read ?? []));
    routes.observe.push(...(app.routes?.observe ?? []));

    for (const [k, v] of Object.entries(app.programs ?? {})) claim(programs, k, v, "program", app);
    for (const [k, v] of Object.entries(app.handlers ?? {})) claim(handlers, k, v, "handler", app);
    for (const [k, v] of Object.entries(app.reactions ?? {})) claim(reactions, k, v, "reaction", app);

    for (const [name, hs] of Object.entries(app.on ?? {})) {
      (on[name as RigEventName] ??= []).push(...(hs ?? []));
    }

    const h = app.hooks;
    if (h?.beforeSend) before.send.push(h.beforeSend);
    if (h?.beforeReceive) before.receive.push(h.beforeReceive);
    if (h?.beforeRead) before.read.push(h.beforeRead);
    if (h?.afterSend) after.send.push(h.afterSend);
    if (h?.afterReceive) after.receive.push(h.afterReceive);
    if (h?.afterRead) after.read.push(h.afterRead);
    if (h?.onError) onError.push(h.onError);
  }

  return {
    routes,
    programs,
    handlers,
    reactions,
    on,
    hooks: {
      beforeSend: chainBefore(before.send),
      beforeReceive: chainBefore(before.receive),
      beforeRead: chainBefore(before.read),
      afterSend: chainAfter(after.send),
      afterReceive: chainAfter(after.receive),
      afterRead: chainAfter(after.read),
      onError: chainOnError(onError),
    },
  };
}
```

## Merge rules at a glance

| Field | Strategy | Collision |
|-------|----------|-----------|
| `routes.receive/read/observe` | concatenate (App order) | none — order is meaningful (read = first-match-wins) |
| `programs` | key-merge by URI prefix | **throws** |
| `handlers` | key-merge by code | **throws** |
| `reactions` | key-merge by URI pattern | **throws** |
| `on` events | concatenate handler arrays per event | none — all run |
| `hooks.before*` | chain sequentially, thread `{ ctx }` | none — all run, any throw rejects |
| `hooks.after*` | run all | none — any throw enforces |
| `hooks.onError` | run all | none — any throw aborts |

Design intents behind those choices:

- **Programs/handlers/reactions throw on collision** because two Apps claiming
  one key is almost always an ownership bug — surface it at startup.
- **Routes concatenate, never throw**, because layering multiple stores over a
  namespace (cache + primary + peers) is a legitimate, ordered topology.
- **Events and hooks fan out**, because cross-cutting concerns are *additive* by
  nature: more audit, more metrics, more gates.

## When to use which core primitive

| You want to… | Reach for | Lives in |
|--------------|-----------|----------|
| Define a payload shape + its URIs | a Canon | data layer (pure) |
| Store/serve a slice of the URI space | a Domain PIN | capability layer |
| Decide what a *valid* write is (domain logic) | a `Program` + `CodeHandler` | an App |
| Maintain derived state (counts, feeds, indexes) | a `Reaction` | an App |
| Push effects out (metrics, email) | an `on` event handler | an App |
| Enforce cross-cutting policy (auth, rate, audit) | a hook (often a policy App) | an App |
| Serve many behaviors from one node | `composeApps` | the Rig |
| Replicate across machines | `peer` / `flood` / `network` | a replication App |

## Glossary

- **Canon** — the pure data layer for a namespace: types, URI builders,
  validators. No I/O, no rig.
- **Domain PIN** — a `ProtocolInterfaceNode` that stores and serves one URI
  slice. Knows storage, not rules.
- **App** — a named, namespaced bundle of behavior (routes + programs +
  handlers + reactions + hooks + events). The unit you ship.
- **Rig** — many Apps composed into one PIN. Itself a PIN, so Rigs nest.
- **Output** — `[uri, payload]`, the only wire shape.
- **Read-model** — a derived value stored at its own URI and maintained by a
  reaction, so reads stay exact-fetch (no query grammar).
- **Policy App** — an App with only hooks: cross-cutting behavior, no Canon.

## Where each layer ships

| Layer | Where it should live | Why |
|-------|----------------------|-----|
| `App` + `composeApps` | core (`src/app/`) or a shared kit | pure `RigConfig` algebra; broadly reusable |
| Canons | a sugar package (e.g. `chirp-canon`) | depends only on core *types* |
| Domain PINs | per-store packages (often via `b3nd-save` adapters) | storage-specific |
| Apps | one package per behavior | shippable, independently versioned |
| Rig assembly | the deployable | the only place that knows the whole topology |

Core stays protocol-agnostic; everything domain-shaped lives above it. That's
the invariant the whole model protects.

---

**Back to** [the table of contents](./README.md).
</content>

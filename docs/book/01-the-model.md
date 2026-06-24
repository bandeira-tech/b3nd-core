# Chapter 1 — The model

> Four layers. Each one knows less than the one above it, and nothing about the
> one below it but its URIs.

Before any code, the map. b3nd-core is a routing engine for `Output` tuples
(`[uri, payload]`). It has exactly one composition surface today: a flat
`RigConfig`. That's perfect for *one* behavior and awkward for *many* — which
is the whole reason this book exists. Here is the layering we'll build through.

```
┌─ Rig ─────────────────────────────── composition   (core, shipped)
│   one PIN, many behaviors
│   ┌─ App ──────────────────────────── behavior      (you ship these)
│   │   programs · handlers · reactions · hooks · routes
│   │   ┌─ Domain PIN ───────────────── capability    (storage / transport)
│   │   │   receive · read · observe · status
│   │   │   ┌─ Canon ───────────────── data           (pure: models + URIs)
│   │   │   │   types · uri builders · validators
```

## Layer 0 — the core (given)

You already have this. The relevant vocabulary:

| Core thing | What it is | Defined in |
|------------|------------|-----------|
| `Output<T>` | `[uri, payload]` — the only wire shape | `src/types/types.ts` |
| `ProtocolInterfaceNode` (PIN) | `receive` / `read` / `observe` / `status` | `src/types/types.ts` |
| `connection(client, patterns)` | binds a PIN to a URI glob list | `src/rig/connection.ts` |
| `Program` | classifies a write → a `code` string | `src/types/types.ts` |
| `CodeHandler` | turns a `code` into the `Output[]` to dispatch | `src/types/types.ts` |
| `Reaction` | fires on a written URI → emits more `Output[]` | `src/rig/reactions.ts` |
| Hooks | sync gates around operations (throw to reject) | `src/rig/hooks.ts` |
| `Rig` | runs the pipeline, routes per operation | `src/rig/rig.ts` |

The pipeline a write travels through:

```
receive([out]) → beforeReceive hook → Program (classify) → CodeHandler (transform)
              → routes.receive (broadcast to matching connections)
              → reactions (cascade) → afterReceive hook → events (async)
```

## Layer 1 — Canon (data-first)

A **Canon** is the data layer for one namespace: the TypeScript types of your
payloads, the functions that build and recognize your URIs, and the validators
that say what a well-formed payload looks like. It is **pure** — it imports
nothing from the rig and performs no I/O. You can unit-test it with no harness.

> Why "Canon"? Because it's the canonical definition of a slice of the URI
> space — the shapes and addresses everyone else agrees on. `docs/backends.md`
> already uses the word this way.

Building the Canon first is what makes the whole system *data-first*: the URIs
and shapes are settled before a single rule or storage decision is made.

## Layer 2 — Domain PIN (capability)

A **Domain PIN** is a `ProtocolInterfaceNode` that owns a slice of the URI
space — it knows how to **store** and **serve** the Canon's resources. It
answers `receive` (writes), `read` (queries), `observe` (change streams), and
`status`. It knows about *storage*; it does **not** know your domain *rules*.
(A SQL-backed store, an in-memory map, an HTTP proxy to another node, and an
aggregator over several stores are all Domain PINs.)

## Layer 3 — App (behavior — the unit you ship)

An **App** is a named, namespaced bundle of *behavior* expressed in core's
primitives:

```ts
interface App {
  name: string;
  routes?:    RigRoutes;                       // which PIN serves which URIs
  programs?:  Record<string, Program>;          // how writes are classified
  handlers?:  Record<string, CodeHandler>;      // what each classification does
  reactions?: Record<string, Reaction>;         // cascades on successful writes
  hooks?:     HooksConfig;                       // cross-cutting gates
  on?:        Partial<Record<RigEventName, EventHandler[]>>; // async side-effects
}
```

The defining property: **an App only ever touches its Canon's URIs.** That's
what lets two Apps live in one Rig without colliding. The App is where domain
*actions* live — "a valid post is persisted", "liking a post bumps a counter",
"a follow notifies the followee". You ship Apps; you don't ship Rigs.

> In the proposal that started this, these were tentatively called
> "action-based components". `App` is the better name: `send`/`receive` are
> already *the* actions in the rig, so "action component" is ambiguous, and
> "App" is exactly the word for "a composable unit of behavior you ship and
> mount". If you want a word for the *parts* of an App, they're just the core
> primitives — programs, handlers, reactions.

## Layer 4 — Rig (composition)

A **Rig** is many Apps merged into one PIN. The merge is the missing primitive:
`composeApps(apps) → RigConfig`. It concatenates routes, key-merges programs /
handlers / reactions (throwing on collisions), chains hooks, and fans out
events. The result is a single node that serves every behavior at once and is
*itself* a PIN — so a Rig can be a Domain PIN inside a bigger Rig.

```ts
const node = new Rig(composeApps([
  profilesApp(profileStore),
  postsApp(postStore),
  followsApp(followStore),
]));
```

## The shape of the rest of the book

We'll build `chirp://`, a microblog, one layer at a time:

- **Ch 2** — the `profiles` Canon, an in-memory Domain PIN, a bare Rig. Write
  and read a profile.
- **Ch 3** — the `posts` Canon and the first real App: validation as a Program.
- **Ch 4** — likes, counters, notifications — derived state via reactions.
- **Ch 5** — `follows` and `moderation` Apps composed into the same node.
- **Ch 6** — signed writes and rate limits, as policy that spans Apps.
- **Ch 7** — two nodes replicating `chirp://` over the network.

On to [Chapter 2 — Hello, data](./02-hello-data.md).
</content>

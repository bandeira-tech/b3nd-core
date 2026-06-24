# Chapter 7 — Going distributed

> A Rig is a PIN. A remote node is a PIN. So replicating `chirp://` across
> machines is just wiring PINs to PINs — no new concepts, only new connections.

Everything we've built is local. Now two people run their own `chirp` node and
want each other's posts. Core's `network` primitives turn a set of peer PINs
into replication without changing a single App. The Apps don't know they've
gone distributed; that's the reward for keeping behavior namespaced and pure.

## 1. The pieces

| Primitive | Role |
|-----------|------|
| `peer(client, opts?)` | wraps a remote PIN as a network peer (with an id) |
| `flood(peers)` | a strategy: broadcast `receive` to all peers; merge their `observe` |
| `pathVector(peers)` | flood **plus** signer-chain loop filtering (for meshes) |
| `tellAndRead` | announce small notices; pull full payloads on demand |
| `network(rig, peers, [strategy])` | makes the local rig *join* the mesh by observing peers |

There are two directions to wire, and you usually want both:

- **Outbound** — your writes should reach peers. You add a peer-backed
  connection to your `receive`/`read`/`observe` routes (or, more simply, mount a
  tiny "replication App" whose routes point at the strategy client).
- **Inbound** — peers' writes should reach you. That's `network(rig, peers)`,
  which observes each peer and feeds their changes into your rig.

## 2. A replication App

Replication is, satisfyingly, *just another App*. It contributes a connection
whose client is a network strategy over your peers, bound to the part of the
URI space you want to share.

```ts
// chirp/apps/replication/app.ts
import { connection, flood, peer } from "@bandeira-tech/b3nd-core";
import type { App, ProtocolInterfaceNode } from "@bandeira-tech/b3nd-core";

export const replicationApp = (remotes: ProtocolInterfaceNode[]): App => {
  const peers = remotes.map((c) => peer(c));
  const fan = flood(peers); // a PIN: broadcasts receive, merges observe

  // Share posts, likes and follows; keep notifications/moderation local.
  const shared = connection(fan, [
    "chirp://posts/**",
    "chirp://posts/*/likes/*",
    "chirp://follows/*/*",
  ]);

  return {
    name: "replication",
    routes: { receive: [shared], read: [shared], observe: [shared] },
  };
};
```

Mount it alongside the local store. Because routes **concatenate** and `read`
is first-match-wins, order expresses your topology — *local first, peers as
fallback*:

```ts
const rig = new Rig(composeApps([
  postsApp(localStore),         // local storage for posts…
  likesApp(localStore),
  followsApp(localStore),
  replicationApp([nodeB, nodeC]), // …and the peer fan-out, after local
]));
```

Now a local `receive` of a post lands in `localStore` **and** floods to peers
B and C; a `read` checks local storage first and only reaches peers if no local
connection accepts the locator.

## 3. Receiving peers' writes

Outbound covers *your* writes leaving. To pull *their* writes in, let the rig
observe the peers and ingest changes:

```ts
import { network, peer } from "@bandeira-tech/b3nd-core";

const stop = network(rig, [peer(nodeB), peer(nodeC)]);
// rig now observes B and C; their changes flow into rig.receive,
// back through the full pipeline — your programs, hooks, and
// reactions run on replicated writes exactly as on local ones.
// call stop() to leave the mesh.
```

This is the subtle, powerful part: **inbound replication re-runs your
pipeline.** A post that arrives from a peer is re-validated by your posts
program, re-checked by your auth hook, and triggers your feed/moderation
reactions locally. You don't trust the peer's behavior — you apply your own.

## 4. Loops and convergence

Two things to respect once writes flow in both directions:

- **Loops.** With a plain `flood`, A→B→A can echo. In a real mesh use
  `pathVector(peers)`, which carries a signer chain and drops writes whose
  chain already includes you. It pairs with `Identity` (Chapter 6): every hop
  signs, and the chain is the loop filter.
- **Convergence.** Our Chapter-4 like counter did `read; +1; write` — fine on
  one node, racy across many. For replicated derived state, prefer
  *commutative* representations: store each like as its own URI
  (`chirp://posts/p1/likes/<handle>`, which we already do) and compute the count
  as `read` over that set in a Domain PIN that can list, rather than maintaining
  a shared mutable integer. Reactions are still great for *local* read-models;
  just make the *replicated* truth a set of independent facts.

## 5. The whole picture

```
   ┌─────────── Node A ───────────┐        ┌─────────── Node B ───────────┐
   │ Rig = composeApps([          │        │ Rig = composeApps([          │
   │   posts, likes, follows,     │  flood │   posts, likes, follows,     │
   │   moderation, auth,          │◀──────▶│   moderation, auth,          │
   │   replication([B]) ])        │ observe│   replication([A]) ])        │
   │   localStore (Domain PIN)    │        │   localStore (Domain PIN)    │
   └──────────────────────────────┘        └──────────────────────────────┘
```

Same Apps on both sides. Same Canon. The only thing that differs between a
laptop demo and a federation is which PINs are in the `replication` App's peer
list. That is the goal we set in Chapter 1: build data-first, ship behaviors,
compose them into nodes — and the nodes compose into a network the same way.

[Chapter 8](./08-reference.md) is the reference: the full `App` / `composeApps`
source, the exact merge rules, and a glossary.
</content>

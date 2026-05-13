# @bandeira-tech/b3nd-sdk/network

Peer-network primitives for B3nd. Compose `ProtocolInterfaceNode` clients into
peer collections that are consumed in one of two ways:

- **`network(target, peers, policies?, opts?)`** — the participant verb. Wires
  peer observe streams into a target's receive pipeline and returns an async
  unbind. Zero or more `Policy`s chain inbound event translations.
- **Strategy factories** (`flood(peers)`, `pathVector(peers)`, …) — each returns
  a plain `ProtocolInterfaceNode` built from the peer list. Use as rig
  connections: `connection(flood(peers), patterns)`.

Same peer primitive, two different shapes on the consumer side. The shapes are
disjoint (a function vs. a `ProtocolInterfaceNode`), so passing one where the
other is expected is a compile error.

## Install & import

```ts
import {
  bestEffort, // peer decorator — swallows per-peer receive errors
  flood,
  network,
  pathVector,
  peer,
  type Policy,
  tellAndRead,
} from "@bandeira-tech/b3nd-sdk/network";
```

## Mental model

```
           peer list
               │
      ┌────────┴──────────┐
      │                   │
      ▼                   ▼
network(target, peers,   flood(peers)          ← strategy factories
        policies?,        pathVector(peers)     (return PIN)
        opts?)
  (participant verb,
   returns unbind)                │
      │                           │
      ▼                           ▼
peer events                 connection(npi, patterns)
→ target.receive            (used in Rig connections list)
```

## Concepts

### Peer

A `Peer` is a client plus a stable id used for local routing control.

```ts
peer(client); // id auto-assigned (runtime UUID)
peer(client, { id: "B" }); // explicit id — use for cryptographic
// identities (e.g., pubkey-based
// path-vector loop avoidance)
peer(client, { via: [bestEffort] }); // stack middleware
```

### Policy (participant only)

```ts
interface Policy {
  receive?(ev, source, ctx): AsyncIterable<ReadResult>;
}
```

Each policy's `receive` runs on every event observed from a peer. The policy can
yield the event unchanged, drop it (yield nothing), rewrite it, or issue
side-requests via `source.client.read(uri)` and yield the fetched content.

Pass multiple policies as an array — they chain left-to-right, each yielded
event flowing through the next:

```ts
network(rig, peers, [filter, tellAndRead, audit]);
```

### Strategy factories

```ts
flood(peers); // fan-out to all, first-match read, merged observe
pathVector(peers); // flood + signer-chain loop filter
// future: roundRobin, firstAccept, etc.
```

Each returns a plain `ProtocolInterfaceNode`. The outbound policy is baked in;
there's no Policy argument at this layer. If you need a different strategy, use
(or write) a different factory.

## Three deployment shapes

### Mode 1 — remote-client (strategy factory only)

```ts
const rig = new Rig({
  connections: [connection(flood(peers), { receive: ["*"], read: ["*"] })],
});
```

Use when the local rig is a _consumer_ of the network. Writes fan to every peer;
reads try peers in order. Typical for browser apps, CLI tools, background
workers — anything that doesn't itself _participate_ in gossip by serving
observe streams back to peers.

### Mode 2 — participant (`network()` only)

```ts
const unbind = network(rig, peers);
```

Use when the local rig _joins_ the mesh by pulling from peers over their observe
streams. `network()` feeds the rig's receive pipeline with events observed on
each peer, tagged by source. Typical for nodes that run their own HTTP/SSE
server and are observed by other nodes in return.

### Mode 3 — full participant (both — requires pathVector + signing)

```ts
const rig = new Rig({
  connections: [
    connection(localStore, { receive: ["*"], read: ["*"] }),
    connection(pathVector(peers), { receive: ["mutable://*"] }),
  ],
});
const unbind = network(rig, peers);
```

The outbound `pathVector(peers)` connection filters per-peer by signer chain, so
a message signed by A is never re-broadcast to A. The inbound
`network(rig, peers)` feeds peer writes into the rig's receive pipeline.

Sign outbound messages with `Identity.sign()` + `message()` so they carry a
signer chain. Unsigned content in a bidirectional mesh will loop — the outbound
path cannot know the origin without the chain on the wire. For unsigned content,
use a DAG topology (push-only on one side) or add a rig-level `beforeReceive`
seen-set hook.

## Example: participant node with sync filter

```ts
import { network, peer } from "@bandeira-tech/b3nd-sdk/network";
import {
  connection,
  HttpClient,
  MemoryStore,
  Rig,
  SimpleClient,
} from "@bandeira-tech/b3nd-sdk";

const local = new SimpleClient(new MemoryStore());
const peers = [
  peer(new HttpClient({ url: "https://node-b" }), { id: "B" }),
  peer(new HttpClient({ url: "https://node-c" }), { id: "C" }),
];

const rig = new Rig({
  connections: [connection(local, { receive: ["*"], read: ["*"] })],
  reactions: {
    "mutable://chat/:id": (uri) => console.log("saw", uri),
  },
});

// Peer writes stream into the rig's receive pipeline and fire
// reactions / programs / hooks as if they were local writes.
const unbind = network(rig, peers);
// later:
await unbind();
```

## Example: federation (remote-client)

```ts
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";
import { connection, HttpClient, Rig } from "@bandeira-tech/b3nd-sdk";

const peers = [
  peer(new HttpClient({ url: "https://node-b" }), { id: "B" }),
  peer(new HttpClient({ url: "https://node-c" }), { id: "C" }),
];

const rig = new Rig({
  connections: [
    connection(flood(peers), { receive: ["*"], read: ["*"], observe: ["*"] }),
  ],
});

await rig.receive([["mutable://shared/hello", {}, { text: "hi" }]]);
const r = await rig.read("mutable://shared/hello");
```

## Example: content sync with `tellAndRead`

Announce small messages on the wire; let consumers pull the full payload via
`read()` only when they want it. The "pull" leg is the existing
`ProtocolInterfaceNode.read` — no new protocol, no new transport, no special
side-channel. URI layout for announcements is the protocol author's call; the
framework never peeks at a scheme.

```ts
import { network, peer, tellAndRead } from "@bandeira-tech/b3nd-sdk/network";
import { connection, Rig } from "@bandeira-tech/b3nd-sdk";

const sync = tellAndRead({
  // Outbound: rewrite every hash:// payload into a tiny inv:// message.
  announce: (msgs) =>
    msgs.map(([uri]) =>
      uri.startsWith("hash://")
        ? [`inv://${uri}`, {}, { have: uri }]
        : [uri, {}, null /* untouched */]
    ),
  // Inbound: when we see an inv:// announcement, return the URI to pull
  // from the source peer via its existing read().
  onAnnounce: (ev) => {
    if (!ev.uri?.startsWith("inv://")) return null; // passthrough
    const have = (ev.record?.data as { have: string }).have;
    return [have]; // pull it
  },
});

const rig = new Rig({
  connections: [
    connection(localStore, { receive: ["*"], read: ["*"] }),
    // Outbound: announce hash:// content; everything else flows as-is.
    connection(sync.outbound(peers), { receive: ["hash://*"] }),
  ],
});

// Inbound: announcements flowing from peer observe streams trigger pulls.
const unbind = network(rig, peers, [sync.inbound]);
```

Compound announcements, per-peer asymmetry ("full to trusted, INV to others"),
and "I already have it" short-circuits are all expressible in the
`announce`/`onAnnounce` hooks — see `tell-and-read.test.ts` for worked cases.

## Example: signed full-participant mesh

```ts
import { network, pathVector, peer } from "@bandeira-tech/b3nd-sdk/network";
import { connection, HttpClient, Rig } from "@bandeira-tech/b3nd-sdk";

// Peer ids MUST be the peers' signing pubkey (hex) for pathVector to
// recognize them in the signer chain.
const peers = [
  peer(new HttpClient({ url: "https://node-b" }), { id: bPubkeyHex }),
  peer(new HttpClient({ url: "https://node-c" }), { id: cPubkeyHex }),
];

const rig = new Rig({
  connections: [
    connection(localStore, { receive: ["*"], read: ["*"] }),
    connection(pathVector(peers), { receive: ["mutable://*"] }),
  ],
});
const unbind = network(rig, peers);

// Sign outbound messages so they carry a signer chain.
// When A signs a message and it reaches B, pathVector on B's outbound
// connection drops the re-broadcast to A because A is already in the
// chain. Arbitrary longer cycles are also cut as the chain grows per
// relay.
```

## Ergonomics

**Batch-native.** Strategy factories deliver message batches to each peer via
`peer.client.receive(msgs)` unchanged. Policies on the participant side operate
per-event because that matches how observe streams arrive.

**URI-agnostic.** The framework never peeks at a URI scheme. `hash://`,
`mutable://`, anything else — all opaque to network. Protocols define URI
layout; policies act on it.

**Content-routed side-channels.** When a policy needs to reply to a specific
peer (e.g., pull a full payload after an announcement), it calls
`ctx.source.client.read(uri)` or `ctx.source.client.receive([msg])`. No special
side-channel API — everything is addressed content flowing through
`ProtocolInterfaceNode`. Works in browsers, serverless, embedded.

## Roadmap

| PR   | Status     | Scope                                                                                                      |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| PR-1 | ✅ merged  | `peer`, network skeleton, subpath export, tests                                                            |
| PR-2 | ✅ merged  | observe-bridge, source tagging, unbind                                                                     |
| PR-3 | ✅ merged  | `network()` verb + `flood(peers)` + `pathVector(peers)` + policy-chain composition inline                  |
| PR-4 | ✅ merged  | `tellAndRead` — INV/READ-style content sync; outbound strategy factory + inbound Policy                    |
| PR-5 | ✅ shipped | `bestEffort` peer decorator; `createPeerClients → Peer[]`; retire `b3nd-combinators`; full-lib review pass |

## Tests

Run with `deno test --allow-all libs/b3nd-network/`. No sanitizer overrides —
Deno's op and resource sanitizers are active on every test.

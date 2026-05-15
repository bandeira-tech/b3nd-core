# B3nd Core

Framework foundation for B3nd. Types, encoding, clients, Rig, Identity, network
primitives -- everything needed to run a decentralized network without any
protocol-specific logic.

[GitHub](https://github.com/bandeira-tech/b3nd-core)

## The Rig

The Rig wires storage, validation, and behavior into a single object that speaks
the `ProtocolInterfaceNode` (PIN) interface.

```typescript
import { connection, Rig } from "@bandeira-tech/b3nd-core";
import { count, list } from "@bandeira-tech/b3nd-core/url";
import { DataStoreClient } from "@bandeira-tech/b3nd-save/clients";
import { MemoryStore } from "@bandeira-tech/b3nd-save/memory";

const client = new DataStoreClient(new MemoryStore());

const rig = new Rig({
  routes: {
    receive: [connection(client, ["*"])],
    read: [connection(client, ["*"])],
  },
});

await rig.receive([["mutable://open/users/alice", { name: "Alice" }]]);
await rig.receive([["mutable://open/users/bob", { name: "Bob" }]]);

// Heterogeneous batch in one call: profile + count + listing.
// `read` returns a flat `Output[]` — `[uri, payload]` tuples — same
// shape as `receive` accepts. The framework speaks one shape end-to-end.
const [profile, total, ...users] = await rig.read([
  "mutable://open/users/alice",
  count("mutable://open/users"),
  list("mutable://open/users", { limit: 10, sortBy: "uri" }),
]);

profile?.[1]; // { name: "Alice" }
total?.[1]; // 2          — addressed at "b3nd://count/mutable://open/users"
users.map((r) => r[0]); // ["mutable://open/users/alice", "mutable://open/users/bob"]
```

### URL grammar

Reads and observes accept _urls_: a uri plus a query string carrying a function
(`fn=`) and parameters. The uri is the routing identity; the query is
request-time-only.

```
mutable://users/alice                          → fn=read (default)
mutable://users/?fn=count                      → count under prefix
mutable://users/?format=uris&limit=12          → ls, uri-only, paginated
mutable://feed/?fn=x-ig.rank&x-ig.cursor=eyJ   → provider extension
```

Reserved fns: `read`, `ls`, `count`. Anything beginning with `x-` is a
provider-defined extension. Build urls with the helpers (`count`, `list`,
`listUris`, `x`) — see [`src/url/url.ts`](./src/url/url.ts).

```typescript
import { count, list, listUris, x } from "@bandeira-tech/b3nd-core/url";

const outputs = await pin.read([
  "instagram://users/alice", // simple read
  count("instagram://users/alice/posts/"), // count of posts
  listUris("instagram://users/alice/posts/", {
    limit: 12,
    sortBy: "timestamp",
    sortOrder: "desc",
  }), // first page of post uris (no payloads)
  x("instagram://hashtags/coffee/", "x-ig.rank", {
    limit: 30,
    ext: { "x-ig.cursor": "eyJ…" },
  }), // provider extension
]);
// outputs = [
//   ["instagram://users/alice", { name: "Alice", … }],
//   ["b3nd://count/instagram://users/alice/posts/", 4127],
//   ["instagram://users/alice/posts/p1", undefined], // listUris omits payload
//   …
//   ["b3nd://x-ig.rank/...", { /* provider-shaped payload */ }],
// ]
```

### Errors and content

The framework speaks one shape — `Output[]` — end-to-end. There is no explicit
failure channel and no framework opinion on payload content:

- **Transport / programmer errors throw**: network down, malformed url, no route
  accepts, unknown reserved fn — they propagate as exceptions.
- **Anything else lives in the payload by protocol convention.** Miss
  representation, auth refusals, domain errors, binary encoding — all chosen
  and documented by your store / canon, not by the framework.

The framework reserves the `b3nd://` namespace for any uri a protocol has to
invent (count answers, observe envelopes, cursors). Each protocol picks its own
sub-paths.

### Observe (INV-style)

`observe` yields `Output<string[]>` packages — `[inputUrl, uris]` — where
`inputUrl` echoes the caller's subscription url whose pattern matched and
`uris` is the list of uris that changed in this batch. Read each uri to learn
its current state.

```typescript
const ac = new AbortController();
for await (const [, uris] of pin.observe(["mutable://app/*"], ac.signal)) {
  const outputs = await pin.read(uris);
  for (const [uri, payload] of outputs) console.log(uri, payload);
}
```

### Connections

Connections bind clients to URI patterns. The rig routes per operation:

- **receive** — broadcast to every matching connection.
- **read** — for each url, the first connection that accepts the routing key
  wins. **No fall-through, no aggregation.** Compose a memcache + shards
  aggregator as its own client and route to that if you want layered storage.
- **observe** — urls are grouped by the first matching connection;
  per-connection streams are merged into one.

```typescript
const rig = new Rig({
  routes: {
    receive: [connection(postgresClient, ["mutable://*", "hash://*"])],
    read: [connection(postgresClient, ["mutable://*", "hash://*"])],
    observe: [connection(postgresClient, ["mutable://*", "hash://*"])],
  },
});
```

### Programs and Handlers

Programs are pure functions that classify messages by URI prefix. Handlers
decide what each classification code means operationally.

```typescript
const rig = new Rig({
  routes: {/* ... */},
  programs: {
    "store://balance": balanceProgram,
  },
  handlers: {
    "balance:valid": async (msg) => [msg], // persist as-is
  },
});
```

### Identity

Ed25519 signing + X25519 encryption, seed-deterministic or generated.

```typescript
const id = await Identity.fromSeed("my-secret");
const auth = await id.sign({ action: "transfer", amount: 100 });
const valid = await id.verify(
  { action: "transfer", amount: 100 },
  auth.signature,
);
```

### Hooks, Events, Reactions

```typescript
const rig = new Rig({
  routes: {/* ... */},
  hooks: {
    beforeReceive: (ctx) => {/* throw to reject */},
    beforeRead: (ctx) => {
      // ctx is just { url }; parseUrl is a cheap pure function — call
      // it if you need fn/params, return `{ ctx: { url } }` to rewrite.
      // For invasive transforms, wrap the executing client instead.
    },
    afterRead: (ctx, result) => {/* observe */},
    onError: (ctx) => {/* handle errors */},
  },
  on: {
    "receive:success": [(e) => notifyPeers(e)],
    "*:error": [(e) => alertOps(e)],
  },
  reactions: {
    "mutable://app/users/:id": async (output) => {/* triggered on write */},
  },
});
```

- **Hooks** -- synchronous gates (throw to reject, observe after, catch errors)
- **Events** -- async fire-and-forget (never block the caller)
- **Reactions** -- URI-pattern triggers on successful writes

### HTTP API

Core ships no HTTP/WS transports of its own — they live in
`@bandeira-tech/b3nd-move` and consume a rig (or any
`ProtocolInterfaceNode`) over the wire-stable PIN interface:

```typescript
import { httpService } from "@bandeira-tech/b3nd-move/http/service";

Deno.serve({ port: 9942 }, httpService(rig));
```

See [b3nd-move](https://github.com/bandeira-tech/b3nd-move) for HTTP,
WebSocket, gRPC-HTTP, and MCP transports — all framework-agnostic
`(Request) => Promise<Response>` handlers.

### Network

Peer-to-peer replication with pluggable policies.

```typescript
import { flood, network, peer } from "@bandeira-tech/b3nd-core";

const stop = network(localRig, [
  peer(remoteClient),
], [flood()]);
```

## Modules

| Module             | What's in it                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `types`            | `ProtocolInterfaceNode`, `Output`, `Message`, `B3ndError`, `Errors`, …  |
| `url`              | URL grammar + helpers (`count`, `list`, `listUris`, `x`, `parseUrl`)    |
| `encoding`         | Base64 / hex primitives                                                 |
| `hash`             | SHA-256                                                                 |
| `encrypt`          | Ed25519 signing, X25519 encryption, AES-GCM, PBKDF2                     |
| `rig`              | Rig, Identity, connections, hooks, events, reactions                    |
| `identity`         | `Identity` (re-export of `rig/identity`)                                |
| `network`          | `network()`, `peer()`, flood, path-vector, tell-and-read                |
| `client-console`   | Console output client (write-only, debug sink)                          |

Stores (Postgres, SQLite, S3, IndexedDB, …) and Store→PIN client adapters
live in [@bandeira-tech/b3nd-save](https://github.com/bandeira-tech/b3nd-save).
HTTP, WebSocket, gRPC-HTTP, and MCP transports live in
[@bandeira-tech/b3nd-move](https://github.com/bandeira-tech/b3nd-move).

## Subpath Exports

```typescript
import { ... } from "@bandeira-tech/b3nd-core";              // everything
import type { ... } from "@bandeira-tech/b3nd-core/types";    // types only
import { ... } from "@bandeira-tech/b3nd-core/url";           // url grammar + helpers
import { ... } from "@bandeira-tech/b3nd-core/encoding";      // base64 / hex primitives
import { ... } from "@bandeira-tech/b3nd-core/hash";          // sha256
import { ... } from "@bandeira-tech/b3nd-core/encrypt";       // signing, encryption
import { ... } from "@bandeira-tech/b3nd-core/rig";           // Rig + connections
import { ... } from "@bandeira-tech/b3nd-core/identity";      // Identity
import { ... } from "@bandeira-tech/b3nd-core/network";       // network primitives
import { ... } from "@bandeira-tech/b3nd-core/client-console"; // console client
```

## Building a backend

If you're writing a b3nd-store (Postgres, IndexedDB, S3, etc.) — see
[`docs/backends.md`](./docs/backends.md). It covers the `read(urls)` contract,
the reserved `fn` set, which params are spec'd vs. open, the extension recipe,
and capability advertisement.

## Development

```bash
deno task test        # Run tests
deno task check       # Type check
deno fmt --check mod.ts src/
deno lint mod.ts src/
```

## Project Structure

```
mod.ts          # Main entry point + subpath re-exports
src/            # One folder per module (types, url, rig, network, …)
scripts/        # Build tooling (build-npm.ts)
```

## Related

- [b3nd-canon](https://github.com/bandeira-tech/b3nd-canon) -- protocol toolkit
  (msg, hash, auth, encrypt, wallet)
- [b3nd-sdk](https://github.com/bandeira-tech/b3nd-sdk) -- SDK umbrella that
  re-exports core + canon

## License

MIT

# B3nd Core

Framework foundation for B3nd. Types, encoding, clients, Rig, Identity, network
primitives -- everything needed to run a decentralized network without any
protocol-specific logic.

[GitHub](https://github.com/bandeira-tech/b3nd-core)

## The Rig

The Rig wires storage, validation, and behavior into a single object that speaks
the `ProtocolInterfaceNode` (PIN) interface.

```typescript
import {
  connection,
  count,
  DataStoreClient,
  list,
  MemoryStore,
  Rig,
} from "@bandeira-tech/b3nd-core";

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
const [profile, total, ...users] = await rig.read([
  "mutable://open/users/alice",
  count("mutable://open/users"),
  list("mutable://open/users", { limit: 10, sortBy: "uri" }),
]);

profile.record?.data; // { name: "Alice" }
total.record?.data; // 2
users.map((r) => r.uri); // ["mutable://open/users/alice", "mutable://open/users/bob"]
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
`listUris`, `x`) — see [`url.ts`](./libs/b3nd-core/url.ts).

```typescript
import { count, list, listUris, x } from "@bandeira-tech/b3nd-core/url";

pin.read([
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
```

### Observe (INV-style)

`observe` notifies you that a uri changed; you read the uri to learn its current
state. No payload on the wire — the read path is the single source of truth.

```typescript
const ac = new AbortController();
for await (const ev of pin.observe(["mutable://app/*"], ac.signal)) {
  const [r] = await pin.read([ev.uri]);
  if (r.success) console.log(ev.uri, r.record?.data);
  else console.log(ev.uri, "deleted");
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
      // ctx is { url, uri, fn, params, ext } — rewrite any field.
      if (ctx.fn === "ls" && !ctx.params.limit) {
        return { ctx: { ...ctx, params: { ...ctx.params, limit: 100 } } };
      }
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

```typescript
import { httpApi } from "@bandeira-tech/b3nd-core";

Deno.serve({ port: 9942 }, httpApi(rig));
```

Endpoints:

```
GET  /api/v1/status                → rig.status()
POST /api/v1/receive               → rig.receive([[uri, payload], ...])
POST /api/v1/read                  → body { urls } → ReadResult[]
GET  /api/v1/observe/:pattern      → SSE stream of { uri } events
```

Returns a standard `(Request) => Promise<Response>` handler. Works with
Deno.serve, Hono, Express, Cloudflare Workers.

### Network

Peer-to-peer replication with pluggable policies.

```typescript
import { flood, network, peer } from "@bandeira-tech/b3nd-core";

const stop = network(localRig, [
  peer(remoteClient),
], [flood()]);
```

## Libraries

| Library               | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `b3nd-core`           | Types, url grammar, encoding, binary, client base classes, ObserveEmitter |
| `b3nd-rig`            | Rig, Identity, connections, hooks, events, reactions, HTTP API, factories |
| `b3nd-network`        | `network()`, `peer()`, flood, path-vector, tell-and-read policies         |
| `b3nd-client-memory`  | In-memory Store (no external dependencies)                                |
| `b3nd-client-http`    | HTTP transport client                                                     |
| `b3nd-client-ws`      | WebSocket transport client with reconnection                              |
| `b3nd-client-console` | Console output (write-only, for debugging)                                |
| `b3nd-testing`        | Shared test suites and helpers                                            |
| `b3nd-encrypt`        | Ed25519 signing, X25519 encryption, AES-GCM, PBKDF2                       |

Server-side composition and transports live in
[@bandeira-tech/b3nd-servers](https://github.com/bandeira-tech/b3nd-servers).
Core itself only ships the pure `httpApi(rig)` request handler — feed it to any
HTTP runtime (Deno, Hono, Express, Cloudflare Workers, …).

## Subpath Exports

```typescript
import { ... } from "@bandeira-tech/b3nd-core";              // everything
import type { ... } from "@bandeira-tech/b3nd-core/types";    // types only
import { ... } from "@bandeira-tech/b3nd-core/url";           // url grammar + helpers
import { ... } from "@bandeira-tech/b3nd-core/encoding";      // hex encoding
import { ... } from "@bandeira-tech/b3nd-core/binary";        // binary encoding
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
deno fmt --check mod.ts libs/
deno lint mod.ts libs/
```

## Project Structure

```
mod.ts          # Main entry point + subpath re-exports
rig.ts          # Rig subpath
client-*.ts     # Client subpaths
libs/           # Source for all libraries (see table above)
```

## Related

- [b3nd-canon](https://github.com/bandeira-tech/b3nd-canon) -- protocol toolkit
  (msg, hash, auth, encrypt, wallet)
- [b3nd-sdk](https://github.com/bandeira-tech/b3nd-sdk) -- SDK umbrella that
  re-exports core + canon

## License

MIT

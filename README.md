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
  DataStoreClient,
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

await rig.receive([["mutable://open/greeting", { text: "Hello" }]]);
const data = await rig.readData("mutable://open/greeting");
// { text: "Hello" }
```

### Connections

Connections bind clients to URI patterns. The rig routes automatically -- writes
broadcast to all matching connections, reads try each in order.

```typescript
const rig = new Rig({
  routes: {
    receive: [
      connection(postgresClient, ["mutable://*", "hash://*"]),
    ],
    read: [
      connection(memoryClient, ["mutable://*", "hash://*"]), // fast cache first
      connection(postgresClient, ["mutable://*", "hash://*"]), // fallback
    ],
  },
});
```

### Programs and Handlers

Programs are pure functions that classify messages by URI prefix. Handlers
decide what each classification code means operationally.

```typescript
const rig = new Rig({
  routes: { ... },
  programs: {
    "store://balance": balanceProgram,
  },
  handlers: {
    "balance:valid": async (msg) => { /* persist */ },
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
  routes: { ... },
  hooks: {
    beforeReceive: (ctx) => { /* throw to reject */ },
    afterRead: (ctx, result) => { /* observe */ },
    onError: (ctx) => { /* handle errors */ },
  },
  on: {
    "receive:success": [(e) => notifyPeers(e)],
    "*:error": [(e) => alertOps(e)],
  },
  reactions: {
    "mutable://app/users/:id": async (output) => { /* triggered on write */ },
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

Returns a standard `(Request) => Promise<Response>` handler. Works with
Deno.serve, Hono, Express, Cloudflare Workers.

### Network

Peer-to-peer replication with pluggable policies.

```typescript
import { flood, network, peer } from "@bandeira-tech/b3nd-core";

const net = network(localRig, [
  peer(remoteClient, { patterns: ["mutable://*"] }),
], [flood()]);
```

## Libraries

| Library               | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `b3nd-core`           | Types, encoding, binary, client base classes, ObserveEmitter              |
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
Subpaths: `.` (`createServers`, `ServerResolver`, `withCors`), `./http`
(`httpServer`), `./grpc/server` (`grpcServer`), `./grpc/api` (universal
`grpcApi`), `./grpc/client` (`GrpcClient`), `./grpc/proto` (wire schema).
The universal slice ships to JSR + NPM; the `Deno.serve`-using slice is
JSR-only.

Core itself only ships the pure `httpApi(rig)` request handler — feed it
to any HTTP runtime (Deno, Hono, Express, Cloudflare Workers, …).

## Subpath Exports

```typescript
import { ... } from "@bandeira-tech/b3nd-core";             // everything
import type { ... } from "@bandeira-tech/b3nd-core/types";   // types only
import { ... } from "@bandeira-tech/b3nd-core/encoding";     // hex encoding
import { ... } from "@bandeira-tech/b3nd-core/binary";       // binary encoding
import { ... } from "@bandeira-tech/b3nd-core/network";      // network primitives
import { ... } from "@bandeira-tech/b3nd-core/client-console"; // console client
```

## Development

```bash
deno check src/mod.ts       # Type check
deno test libs/              # Run tests
```

## Project Structure

```
src/           # Entry points and subpath re-exports
libs/          # 13 libraries (see table above)
```

## Related

- [b3nd-canon](https://github.com/bandeira-tech/b3nd-canon) -- protocol toolkit
  (msg, hash, auth, encrypt, wallet)
- [b3nd-sdk](https://github.com/bandeira-tech/b3nd-sdk) -- SDK umbrella that
  re-exports core + canon

## License

MIT

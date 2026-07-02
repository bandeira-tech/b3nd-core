# B3nd Core

Framework foundation for B3nd. Types, encoding, clients, Rig, Identity, network
primitives -- everything needed to run a decentralized network without any
protocol-specific logic.

[GitHub](https://github.com/bandeira-tech/b3nd-core)

## The Rig

The Rig wires clients, validation, and behavior into a single object that
speaks the `ProtocolInterfaceNode` (PIN) interface.

```typescript
import {
  connection,
  FunctionalClient,
  Rig,
} from "@bandeira-tech/b3nd-core";

const store = new Map<string, unknown>();
const client = new FunctionalClient({
  receive: (msgs) => {
    for (const [uri, payload] of msgs) store.set(uri, payload);
    return Promise.resolve(msgs.map(() => ({ accepted: true })));
  },
  read: (urls) =>
    Promise.resolve(
      urls.flatMap((u) => (store.has(u) ? [[u, store.get(u)]] : [])),
    ),
});

const rig = new Rig({
  routes: {
    receive: [connection(client, ["**"])],
    read: [connection(client, ["**"])],
  },
});

await rig.receive([["mutable://open/users/alice", { name: "Alice" }]]);
const [profile] = await rig.read(["mutable://open/users/alice"]);
profile?.[1]; // { name: "Alice" }
```

### Locators

`read` and `observe` take locators — opaque addressing strings. The rig
matches them against route patterns by segment-glob and hands them to the
executing client unchanged. The framework defines no locator grammar; the
client on the other end decides what it accepts (a bare uri, a uri plus
request-time directives, a pattern with wildcards — its choice).

`receive` takes `Output[]` where the first element is a uri — the
canonical resource identifier the payload is written under.

### Errors and content

The framework speaks one shape — `Output[]` — end-to-end. There is no explicit
failure channel and no framework opinion on payload content:

- **Transport / programmer errors throw**: network down, no route accepts,
  malformed locator the executing client rejects — they propagate as exceptions.
- **Anything else lives in the payload by client convention.** Miss
  representation, auth refusals, domain errors, binary encoding — chosen and
  documented by the executing client, not by the framework.

### Observe (INV-style)

`observe` yields `readonly string[]` batches of uris that fired — INV-style.
Default emission is one uri per yield; backends with cheap batching can
coalesce. Which subscription locator matched is not surfaced (cheap to
re-derive locally if you need that routing). Read each uri to learn its
current state.

```typescript
const ac = new AbortController();
for await (const uris of pin.observe(["mutable://app/**"], ac.signal)) {
  const outputs = await pin.read(uris);
  for (const [uri, payload] of outputs) console.log(uri, payload);
}
```

### Connections

Connections bind clients to locator patterns. The rig routes per operation:

- **receive** — broadcast to every matching connection.
- **read** — for each locator, the first connection that accepts wins.
  **No fall-through, no aggregation.** Compose a memcache + shards
  aggregator as its own client and route to that if you want layered storage.
- **observe** — locators are grouped by the first matching connection;
  per-connection streams are merged into one.

```typescript
const rig = new Rig({
  routes: {
    receive: [connection(primaryClient, ["mutable://**", "hash://**"])],
    read: [connection(primaryClient, ["mutable://**", "hash://**"])],
    observe: [connection(primaryClient, ["mutable://**", "hash://**"])],
  },
});
```

#### Pattern syntax

One grammar across `connection`, `observe`, and `reactions`:

- **literal** segments must match exactly,
- `*` matches **exactly one non-empty segment** (no `/`),
- `**` matches **zero or more remaining segments** (only as the last segment).

If a reaction needs a segment value, extract it from the URI — patterns
are bool-only, no captures. Patterns compile once: pure literals to `===`,
`**`-prefix patterns to `String.startsWith`, anything with `*` to a
cached `RegExp`. `:param` segments are rejected at compile time.

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
      // ctx is { url }; locators are opaque — if you need to inspect
      // the grammar, bring your own parser. Return `{ ctx: { url } }`
      // to rewrite. For invasive transforms, wrap the executing client.
    },
    afterRead: (ctx, result) => {/* observe */},
    onError: (ctx) => {/* handle errors */},
  },
  on: {
    "receive:success": [(e) => notifyPeers(e)],
    "*:error": [(e) => alertOps(e)],
  },
  reactions: {
    "mutable://app/users/*": async (output) => {/* triggered on write */},
  },
});
```

- **Hooks** -- synchronous gates (throw to reject, observe after, catch errors)
- **Events** -- async fire-and-forget (never block the caller)
- **Reactions** -- URI-pattern triggers on successful writes

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
| `types`            | `ProtocolInterfaceNode`, `Output`, `B3ndError`, `Errors`, …             |
| `encoding`         | Base64 / hex primitives                                                 |
| `hash`             | SHA-256                                                                 |
| `encrypt`          | Ed25519 signing, X25519 encryption, AES-GCM, PBKDF2                     |
| `rig`              | Rig, Identity, connections, hooks, events, reactions                    |
| `identity`         | `Identity` (re-export of `rig/identity`)                                |
| `network`          | `network()`, `peer()`, flood, path-vector, tell-and-read                |
| `client-console`   | Console output client (write-only, debug sink)                          |

## Subpath Exports

```typescript
import { ... } from "@bandeira-tech/b3nd-core";              // everything
import type { ... } from "@bandeira-tech/b3nd-core/types";    // types only
import { ... } from "@bandeira-tech/b3nd-core/encoding";      // base64 / hex primitives
import { ... } from "@bandeira-tech/b3nd-core/hash";          // sha256
import { ... } from "@bandeira-tech/b3nd-core/encrypt";       // signing, encryption
import { ... } from "@bandeira-tech/b3nd-core/rig";           // Rig + connections
import { ... } from "@bandeira-tech/b3nd-core/identity";      // Identity
import { ... } from "@bandeira-tech/b3nd-core/network";       // network primitives
import { ... } from "@bandeira-tech/b3nd-core/client-console"; // console client
import { RecordingClient } from "@bandeira-tech/b3nd-core/testing"; // PIN test double
```

## Testing

`b3nd-core` ships a first-party PIN test double for use in your own tests:

```typescript
import { RecordingClient } from "@bandeira-tech/b3nd-core/testing";
import type { RecordedCall, RecordedCallOf, RecordingClientFixtures } from "@bandeira-tech/b3nd-core/testing";
```

`RecordingClient` records every `receive`, `read`, `observe`, and `status` call
so you can assert on interactions without a real transport. Use it to test rigs,
programs, and code handlers in-process.

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
src/            # One folder per module (types, rig, network, …)
scripts/        # Build tooling (build-npm.ts)
```

## License

MIT

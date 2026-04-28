# b3nd-rig

The universal harness for b3nd. One import, convention over configuration.

## Quick Start

```typescript
import { connection, DataStoreClient, Identity, Rig } from "@b3nd/rig";
import { MemoryStore } from "@b3nd/client-memory";
import { message } from "@bandeira-tech/b3nd-sdk/msg";

const id = await Identity.fromSeed("my-secret");
const rig = new Rig({
  connections: [
    connection(new DataStoreClient(new MemoryStore()), {
      receive: ["*"],
      read: ["*"],
    }),
  ],
});

// Identity signs, rig delivers
const outputs = [["mutable://myapp/config", { theme: "dark" }]];
const auth = [await id.sign({ inputs: [], outputs })];
const envelope = await message({ auth, inputs: [], outputs });
await rig.send([envelope, ...outputs]);

const data = await rig.readData("mutable://myapp/config");
```

## Two Core Actions

The rig has two core actions. Everything else is observation.

- **`send()`** — outward: dispatches a batch of outputs to the network
- **`receive()`** — inward: accepts a batch of `[uri, values, data]` messages
  from an external source

```typescript
// Send a signed envelope (use Identity.sign() + message() to build it)
const auth = [await id.sign({ inputs: [], outputs })];
const envelope = await message({ auth, inputs: [], outputs });
await rig.send([envelope, ...outputs]);

// Receive a raw message from an external source
await rig.receive([["mutable://open/external", {}, { source: "webhook" }]]);
```

## Observation

```typescript
const results = await rig.read<T>(uri); // ReadResult<T>[] (always array)
const results = await rig.read<T>([u1, u2]); // ReadResult<T>[] (multi)
const results = await rig.read<T>("prefix/"); // ReadResult<T>[] (trailing slash = list)

await rig.readData<T>(uri); // T | null (unwrapped)
await rig.readOrThrow<T>(uri); // T (throws if missing)

await rig.count(uri); // number (trailing-slash count)
await rig.exists(uri); // boolean
```

## Encrypted Operations

```typescript
// Encrypt outputs, then sign and send
const plaintext = new TextEncoder().encode(JSON.stringify(secret));
const encrypted = await id.encrypt(plaintext, recipientPubkey);
const outputs = [[uri, encrypted]];
const auth = [await id.sign({ inputs: [], outputs })];
const envelope = await message({ auth, inputs: [], outputs });
await rig.send([envelope, ...outputs]);

// Read and decrypt
const results = await rig.read(uri);
const payload = results[0]?.record?.data;
const decrypted = await id.decrypt(payload);
const secret = JSON.parse(new TextDecoder().decode(decrypted));
```

## Reactive

```typescript
// Watch a URI for changes (polling with dedup)
for await (const value of rig.watch<T>(uri, { intervalMs: 2000, signal })) {
  console.log("Changed:", value);
}

// Watch a collection (added/removed/changed diffs)
for await (
  const snap of rig.watchAll<T>(prefix, { intervalMs: 2000, signal })
) {
  console.log(
    `${snap.items.size} items, +${snap.added.length} -${snap.removed.length}`,
  );
}

// Real-time observe (routed to client's native transport)
const abort = new AbortController();
for await (const result of rig.observe<T>("mutable://app/*", abort.signal)) {
  console.log(result.uri, result.record?.data);
}
```

## Connections

Clients declare what URIs they accept per-operation. The rig routes
automatically.

```typescript
import { connection, Rig } from "@b3nd/rig";

const rig = new Rig({
  connections: [
    // Read-only cache (tried first for reads)
    connection(redisClient, {
      read: ["mutable://accounts/:key/*", "hash://sha256/*"],
    }),

    // Primary storage (reads + writes)
    connection(postgresClient, {
      receive: ["mutable://*", "immutable://*", "hash://*", "link://*"],
      read: ["mutable://*", "immutable://*", "hash://*", "link://*"],
    }),

    // Local-only (never leaves the device)
    connection(memoryClient, {
      receive: ["local://*", "rig://*"],
      read: ["local://*", "rig://*"],
    }),
  ],
});
```

Writes broadcast to all accepting connections. Reads try accepting connections
in order (first success wins — put cache before primary). Unfiltered clients
accept everything (backwards compat).

Patterns use the same Express-style matching as observe: `:param` captures a
segment, `*` matches the rest.

## Hooks

Hooks are synchronous pipelines that run inside operations. Frozen after init.

- **Pre-hooks** run before the operation. **Throw** to reject — no silent drops.
- **Post-hooks** run after. They observe the result but **cannot modify it**.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  hooks: {
    beforeReceive: (ctx) => {
      validateSchema(ctx);
    },
    beforeSend: (ctx) => {
      requireIdentity(ctx);
    },
    afterRead: (ctx, result) => {
      auditRead(ctx, result);
    },
  },
});
```

Hooks are immutable after init. Want different hooks? Create a new rig.

## Events

Events are async fire-and-forget handlers that run after operations complete.
They never block the caller. Handler errors are caught and logged.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  on: {
    "send:success": [audit, notifyPeers],
    "receive:error": [alertOps],
    "*:success": [metrics], // wildcard — all operations
  },
});

// Runtime event registration
const unsub = rig.on("receive:success", (e) => console.log(e.uri));
unsub(); // remove

rig.off("receive:success", handler); // remove by reference
```

Event names: `send:success`, `send:error`, `receive:success`, `receive:error`,
`read:success`, `read:error`, `*:success`, `*:error`.

## Reactions

URI-pattern reactions that fire on successful writes (send or receive).

```typescript
const rig = new Rig({
  connections: [
    connection(new DataStoreClient(new MemoryStore()), {
      receive: ["*"],
      read: ["*"],
    }),
  ],
  reactions: {
    "mutable://app/users/:id": async (out, _read, { id }) => {
      // Reactions return Output[] — those tuples flow through rig.send.
      return [[`notify://email/${id}`, { kind: "user-updated" }]];
    },
    "hash://sha256/*": async (out) => {
      console.log("new content stored at", out[0]);
      return [];
    },
  },
});

// Runtime registration
const unsub = rig.reaction(
  "mutable://app/posts/:slug",
  async (out, _read, { slug }) => {
    return [[`index://posts/${slug}/rebuild`, { ts: Date.now() }]];
  },
);
unsub(); // remove
```

## Identity

Ed25519 signing + X25519 encryption in one object.

```typescript
const id = await Identity.generate();                        // random
const id = await Identity.fromSeed("passphrase");            // deterministic
const id = await Identity.fromPem(pem, pubkey, encPriv?, encPub?); // from keys
const peer = Identity.publicOnly({ signing: "ab12...", encryption: "cd34..." });

id.pubkey;            // Ed25519 public key hex
id.encryptionPubkey;  // X25519 public key hex
id.canSign;           // true if private keys available
id.canEncrypt;        // true if encryption keys available

await id.sign(payload);                   // { pubkey, signature }
await id.verify(payload, signature);      // boolean
await id.encrypt(data, recipientPubkey);  // EncryptedPayload
await id.decrypt(encryptedPayload);       // Uint8Array
await id.signMessage(payload);            // AuthenticatedMessage
```

## Inspection

```typescript
rig.info();
// {
//   behavior: {
//     hooks: ["beforeReceive", "afterRead"],
//     events: { "receive:success": 1, "*:error": 1 },
//     reactors: 3,
//   },
// }

await rig.status(); // StatusResult { status, schema }
```

## Initialization

```typescript
// Minimal
const rig = new Rig({
  connections: [connection(new DataStoreClient(new MemoryStore()), { receive: ["*"], read: ["*"] })],
});

// Full config
const rig = new Rig({
  connections: [
    connection(postgresClient, { receive: ["mutable://*"], read: ["mutable://*"] }),
    connection(memoryClient, { receive: ["local://*"], read: ["local://*"] }),
  ],
  schema,                                   // optional validation
  hooks: { ... },                           // frozen after init
  on: { ... },                              // event handlers
  reactions: { ... },                        // URI pattern reactions
});
```

## HTTP API

```typescript
import { httpApi } from "@b3nd/rig/http";

const api = httpApi(rig, { statusMeta: { version: "1.0" } });
Deno.serve({ port: 3000 }, api);
```

`httpApi()` is a standalone function — the rig stays pure (orchestration only),
transport is external. Returns a standard `(Request) => Promise<Response>` with
all b3nd API routes including SSE subscriptions. Framework-agnostic — plug into
Deno.serve, Hono, Express, Cloudflare Workers.

## ProtocolInterfaceNode

The Rig structurally satisfies `ProtocolInterfaceNode` (4 methods: `receive`,
`read`, `observe`, `status`). Pass it directly to any function that expects a
client — hooks, events, and reactions fire for every operation.

```typescript
// These all work — the rig IS a client
respondTo(handler, { identity, client: rig });
connect(rig, { prefix, processor });
createHandler(rig, config);
loadConfig(rig, operatorKey, nodeId);
```

## Batch Operations

```typescript
// Send multiple signed envelopes in sequence
for (const env of envelopes) {
  const auth = [await id.sign({ inputs: env.inputs, outputs: env.outputs })];
  const envelope = await message({
    auth,
    inputs: env.inputs,
    outputs: env.outputs,
  });
  await rig.send([envelope, ...env.outputs]);
}
```

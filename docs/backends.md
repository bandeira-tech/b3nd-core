# Building a b3nd backend

This is the contract for anyone implementing a `Store` (Postgres, IndexedDB, S3,
Redis, …) or a full `ProtocolInterfaceNode` (a network-fronted node, an
aggregating client, etc.) for b3nd.

The framework is small — four primitives — and one shape:

> **Everything is `Output`.** `Output<T> = [uri, payload]`. `receive` takes
> `Output[]`, `read` returns `Output[]`, `observe` yields `Output<string[]>`.
> There is no separate result envelope, no `success`/`error` discriminator at
> the framework level. Failures are either thrown (transport / programmer
> errors) or expressed inside the payload by protocol convention. The framework
> doesn't interpret payload values — including "miss," "null," or any other
> content shape.

The read path carries function dispatch (`fn=read|ls|count|x-…`) and standard
parameters (`limit`, `page`, `format`, …) inside the url. This doc pins what the
framework promises, what's reserved, and what you're free to interpret.

> The url grammar lives in [`libs/b3nd-core/url.ts`](../libs/b3nd-core/url.ts).
> It exposes `parseUrl`/`buildUrl`/`routingKey` — that's it. The framework
> doesn't ship sugar builders or fn-specific predicates; the grammar is small
> enough to compose with `buildUrl` directly. Synthetic answer addresses
> (`b3nd://count/...`, observe envelopes) are a per-store convention, not a
> framework one.

---

## 1. The interfaces

There are two implementation surfaces:

### `Store` — mechanical storage

Used when you want b3nd's `SimpleClient` / `DataStoreClient` wrappers to handle
protocol semantics for you (envelope decomposition, deletion-as-data, etc.).
Implement four methods:

```ts
interface Store {
  write(entries: StoreEntry[]): Promise<StoreWriteResult[]>;
  read<T>(urls: string[]): Promise<Output<T>[]>;
  delete(uris: string[]): Promise<DeleteResult[]>;
  status(): Promise<StatusResult>;
  capabilities?(): StoreCapabilities;
}
```

`urls` here are exactly the same shape as `ProtocolInterfaceNode.read` — full
url strings, including the `?fn=…&…` query string. You're expected to parse them
with `parseUrl(url)` and dispatch on `fn`.

### `ProtocolInterfaceNode` — full client

Used when you're not just storage — you're a transport, a router, an aggregator.
Implement the four primitives directly:

> **Aggregator example.** The `flood()` strategy in `b3nd-network` is a working
> aggregator: it takes a list of peer clients and presents them as one
> `ProtocolInterfaceNode`, broadcasting `receive`, trying peers in order on
> `read`, and merging `observe` streams. See
> [`libs/b3nd-network/policies/flood.ts`](../libs/b3nd-network/policies/flood.ts)
> for ~150 lines of reference. A memcache-fronted shard pool follows the same
> shape — wrap your sub-clients, fan-out where useful, first-success-wins where
> useful.

```ts
interface ProtocolInterfaceNode {
  receive(msgs: Message[]): Promise<ReceiveResult[]>;
  read<T>(urls: string[]): Promise<Output<T>[]>;
  observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<Output<string[]>>;
  status(): Promise<StatusResult>;
}
```

The rest of this doc focuses on `read`; observe is INV-style and documented in
the README.

---

## 2. The `read(urls)` contract

```ts
read<T>(urls: string[]): Promise<Output<T>[]>
```

- **Input**: an ordered batch of url strings.
- **Output**: an `Output[]` **1:1 with input** — `[inputUrl, payload]` tuples in
  input order. One slot per request; the first element is the caller's url
  (echoed back), the second is the payload your store/protocol returns.
- **Payload semantics are content/protocol concerns.** The framework does not
  define what "not found" looks like, what `null` means, or how binary is
  encoded. Your store picks conventions and documents them.
- **Throw on transport / programmer errors.** Network down, malformed url,
  unknown reserved fn, unsupported parameters, no route accepts — all throw. The
  rig propagates these as a single batch failure.
- **Empty input** is valid — return `[]`.

### Common shape conventions per `fn`

Stores typically pick payloads along these lines, but none of it is enforced by
the framework — your store is free to do otherwise:

| `fn`               | Outer slot | Common payload                                                      |
| ------------------ | ---------- | ------------------------------------------------------------------- |
| `read`             | 1          | the stored value, or a protocol-defined miss representation         |
| `ls` (format=full) | 1          | `Output<T>[]` — entries under the prefix (each `[entry-uri, data]`) |
| `ls` (format=uris) | 1          | `string[]` — flat list of entry uris                                |
| `count`            | 1          | `number`                                                            |
| `x-*.*`            | 1          | provider-defined                                                    |

The reference `MemoryStore` returns `undefined` for `fn=read` misses when used
in-process; over a JSON wire transport that `undefined` collapses to `null`.
Callers and stores agree out-of-band on how to interpret either.

The first element of each Output is the **input url** the caller passed. For
`fn=ls&format=full`, the inner `Output[]` items use the **entry uri** in their
first element (the matched address), not the input url.

### The `b3nd://` namespace

The framework reserves `b3nd://` for any uri it has to invent — observe-batch
envelopes, store-specific answer addresses, cursors, etc. There is no schema
beyond the namespace rule; stores/canons pick their own sub-paths.

| Use                | Address                         | Payload               |
| ------------------ | ------------------------------- | --------------------- |
| Observe envelope   | `b3nd://observe`                | `string[]` (uri list) |
| Provider extension | `b3nd://<ns>/<...>` (suggested) | provider-defined      |

(`fn=count` no longer carries a synthetic answer address — the count number is
the payload of the outer slot, addressed by the caller's input url.)

---

## 3. The dispatch pattern

The standard implementation is a switch on `fn` that produces exactly one output
per input url:

```ts
import { parseUrl } from "@bandeira-tech/b3nd-core/url";
import type { Output } from "@bandeira-tech/b3nd-core";

async read<T>(urls: string[]): Promise<Output<T>[]> {
  return urls.map((url): Output<T> => {
    const parsed = parseUrl(url);
    switch (parsed.fn) {
      case "read":
        return [url, this.readOne<T>(parsed.uri) as T]; // T | undefined
      case "ls":
        return [url, this.list<T>(parsed) as unknown as T];   // Output<T>[]
      case "count":
        return [url, this.count(parsed) as unknown as T];     // number
      default:
        throw new Error(`MyStore: unsupported fn '${parsed.fn}'`);
    }
  });
}
```

`parseUrl` returns:

```ts
interface ParsedUrl {
  // WHATWG-style structural fields
  protocol: string; // e.g. "mutable", "b3nd"
  hostname: string; // authority after protocol://
  path: string; // everything after protocol://hostname
  program: string; // protocol + "://" + hostname
  // b3nd grammar
  uri: string; // full routing identity (program + path, no query)
  fn: string; // 'read' | 'ls' | 'count' | 'x-...'
  params: ReadParams; // typed standard params (see below)
  ext: Record<string, string>; // x-* extension bag
}
```

Dispatch on `fn`, route on `program`/`hostname`, inspect `ext` directly by its
flat string key (e.g. `ext["x-feed.cursor"]`). The module exports `parseUrl` as
the single entry point — no separate guards or inspectors.

If a url has no explicit `fn=`, the default is `read` (or `ls` when the uri ends
in `/`). If the url's `limit` or `page` is malformed, `parseUrl` throws — that's
a programmer error, let it propagate.

---

## 4. Standard parameters

Spec'd by the framework — every backend should accept these meanings when
applicable:

| Param    | Type     | Notes                                                                                         |
| -------- | -------- | --------------------------------------------------------------------------------------------- |
| `format` | `string` | For `fn=ls`: `'full'` (default; payload is `Output<T>[]`) or `'uris'` (payload is `string[]`) |
| `limit`  | `number` | Max items returned                                                                            |
| `page`   | `number` | Page number — **convention**, see below                                                       |

Open — interpreted per backend, **throw on unsupported values**:

| Param       | Type     | Notes                                   |
| ----------- | -------- | --------------------------------------- |
| `pattern`   | `string` | Glob, regex, substring — your call      |
| `sortBy`    | `string` | `uri`, `timestamp`, your column name, … |
| `sortOrder` | `string` | `asc` or `desc` by convention           |
| `cursor`    | `string` | Opaque pagination cursor                |

### Convention: `page` indexing

`page` is **1-indexed** by convention (page=1 is the first page). Backends are
free to support 0-indexed too, but the reference `MemoryStore` assumes
1-indexed.

### Throw on unsupported params

If a caller asks for `pattern: "foo*"` and you don't support globs, throw:

```ts
throw new Error("MyStore: pattern matching is not supported");
```

Don't silently return empty — that hides the bug from the caller.

---

## 5. Extensions: `x-*` functions and params

If your backend wants to expose something the standard fns don't cover — a
recursive `scan`, a fan-out `aggregate`, a keyspace cursor, a database-specific
predicate — namespace it.

### `x-*` function names

Format: `x-<ns>.<name>`. The `<ns>` is your store/protocol slug; the `<name>` is
the operation.

```ts
import { buildUrl } from "@bandeira-tech/b3nd-core/url";

const url = buildUrl({
  uri: "mutable://users/",
  fn: "x-pg.scan",
  params: { limit: 100 },
  ext: { "x-pg.cursor": "abc123", "x-pg.where": "deleted_at IS NULL" },
});
// → "mutable://users/?fn=x-pg.scan&limit=100&x-pg.cursor=abc123&x-pg.where=…"
```

Inside your `read`:

```ts
case "x-pg.scan":
  return this.pgScan(parsed.uri, parsed.params, parsed.ext);
```

### Extension params

`ext` is a `Record<string, string>` of every query-string key starting with
`x-`. Any key not starting with `x-` is rejected by `buildUrl` — this keeps the
namespace clean.

You can put structured data in your ext values (JSON-encoded, base64, opaque
cursor strings, …) — the framework treats them as opaque.

### Provider Outputs

Your `x-*` results are still `Output[]`. Address synthetic answers under your
reserved namespace:

```ts
// pgScan returns its data Outputs plus a synthetic cursor Output.
[
  ["mutable://users/alice", { name: "Alice" }],
  ["mutable://users/bob", { name: "Bob" }],
  ["b3nd://pg/cursor/<token>", "abc123"],
];
```

The consumer-side sugar (one layer up — see "sugars" below) unpacks the cursor.

---

## 6. Capability advertisement

In `status()`, return the list of `fn` names you handle:

```ts
status(): Promise<StatusResult> {
  return Promise.resolve({
    status: "healthy",
    fns: ["read", "ls", "count", "x-pg.scan"],
  });
}
```

The rig unions `fns` across connections and surfaces the result via its own
`status()` and the `/api/v1/status` HTTP endpoint. This is informational — the
rig does **not** use it for routing today (every matching connection sees every
fn, regardless of advertised support). That may change.

---

## 7. Failure semantics — what throws and what doesn't

| Situation                                          | Action                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Transport broke (DB connection lost, network down) | **Throw** — rig propagates as batch failure                         |
| Caller asked for an unsupported `fn` or param      | **Throw** — programmer error                                        |
| Malformed url                                      | `parseUrl` throws; let it propagate                                 |
| `fn=read` on a missing uri                         | Pick a payload (e.g. `undefined`, `null`, a sentinel) — document it |
| Empty result for a `fn=ls` over a missing prefix   | Empty list (`[]` or `Output<T>[]` per shape)                        |
| Empty result for `fn=count` over a missing prefix  | `0` (or whatever the protocol picks)                                |
| Domain-level "permission denied", quota, etc.      | Encode in payload by protocol convention                            |

Rule of thumb: **the framework knows two things — Output or throw**. Anything
richer — miss representation, error encoding, content shape — lives in your
payload by your protocol's convention.

---

## 8. A 50-line worked example

```ts
import { parseUrl } from "@bandeira-tech/b3nd-core/url";
import type {
  Output,
  ParsedUrl,
  StatusResult,
  Store,
  StoreEntry,
  StoreWriteResult,
} from "@bandeira-tech/b3nd-core";

class MyStore implements Store {
  private kv = new Map<string, unknown>();

  write(entries: StoreEntry[]): Promise<StoreWriteResult[]> {
    for (const e of entries) this.kv.set(e.uri, e.data);
    return Promise.resolve(entries.map(() => ({ success: true })));
  }

  read<T>(urls: string[]): Promise<Output<T>[]> {
    return Promise.resolve(urls.map((url): Output<T> => {
      const p = parseUrl(url);
      switch (p.fn) {
        case "read":
          return [url, this.kv.get(p.uri) as T]; // T | undefined
        case "ls":
          return [url, this.ls<T>(p) as unknown as T]; // Output<T>[]
        case "count":
          return [url, this.count(p) as unknown as T]; // number
        default:
          throw new Error(`MyStore: unsupported fn '${p.fn}'`);
      }
    }));
  }

  private ls<T>(p: ParsedUrl): Output<T>[] | string[] {
    if (p.params.pattern !== undefined) {
      throw new Error("MyStore: pattern not supported");
    }
    const prefix = p.uri.endsWith("/") ? p.uri : `${p.uri}/`;
    let entries = [...this.kv.entries()].filter(([k]) => k.startsWith(prefix));
    if (p.params.sortBy === "uri") {
      const dir = p.params.sortOrder === "desc" ? -1 : 1;
      entries.sort(([a], [b]) => a.localeCompare(b) * dir);
    }
    if (p.params.limit !== undefined) {
      const start = ((p.params.page ?? 1) - 1) * p.params.limit;
      entries = entries.slice(start, start + p.params.limit);
    }
    const format = p.params.format ?? "full";
    if (format === "uris") return entries.map(([uri]) => uri);
    return entries as Output<T>[];
  }

  private count(p: ParsedUrl): number {
    const prefix = p.uri.endsWith("/") ? p.uri : `${p.uri}/`;
    return [...this.kv.keys()].filter((k) => k.startsWith(prefix)).length;
  }

  delete(uris: string[]) {
    for (const u of uris) this.kv.delete(u);
    return Promise.resolve(uris.map(() => ({ success: true as const })));
  }

  status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      fns: ["read", "ls", "count"],
    });
  }
}
```

The reference `MemoryStore` in
[`libs/b3nd-client-memory/store.ts`](../libs/b3nd-client-memory/store.ts) is a
slightly fuller version of this pattern — read it for a working example tested
against the shared store suite.

---

## 9. What the rig promises and doesn't

The rig will:

- Route urls to the first connection whose pattern accepts the routing key.
- Run `beforeRead` / `afterRead` hooks per url with the parsed `{ url }` ctx
  (call `parseUrl` inside the hook if you need fields).
- Re-dispatch the (possibly rewritten) url string the hook returns.
- Fire `read:success` events per Output.
- Multiplex observe streams across multiple matching connections.

The rig will **not**:

- Validate `fn` against advertised `fns` — that's your job.
- Fall through to the next connection on miss — composing fall-through is an
  aggregating client's job (see `flood()`).
- Aggregate results across connections (sum counts, dedup ls items, …) — same.
- Retry, timeout, or rate-limit at the rig level — wrap your client.
- Interpret payload contents (miss representation, binary encoding, etc.).

---

## 10. Sugars live one layer up

The core ships `read(urls): Output[]` and the url helpers. Higher-level
ergonomics — `readData<T>(uri) → T | null`, `readCount(uri) → number`, typed
unwrapping for `b3nd://error/` payloads, etc. — live in a sugar package on top
of core (e.g. `b3nd-canon`). The framework stays mechanistic; the consumer-side
wraps however they like.

---

## 11. Tests for free

If you implement `Store`, drop your factory into the shared suite:

```ts
import { runSharedStoreSuite } from "@bandeira-tech/b3nd-core/testing";
import { MyStore } from "./store.ts";

runSharedStoreSuite("MyStore", { create: () => new MyStore() });
```

The suite covers the basics (write/read round-trip, deletion, batch behavior,
scalar types). Backend-specific tests for `fn=ls`, `fn=count`, sort/limit/page,
and `x-*` extensions you write yourself — look at
[`libs/b3nd-client-memory/store.test.ts`](../libs/b3nd-client-memory/store.test.ts)
for examples.

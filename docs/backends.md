# Building a b3nd backend

This is the contract for anyone implementing a `Store` (Postgres, IndexedDB, S3,
Redis, …) or a full `ProtocolInterfaceNode` (a network-fronted node, an
aggregating client, etc.) for b3nd.

The framework is small — four primitives — but the read path now carries
function dispatch (`fn=read|ls|count|x-…`) and standard parameters (`limit`,
`page`, `format`, …) inside the url. This doc pins what the framework promises,
what's reserved, and what you're free to interpret.

> The url grammar lives in [`libs/b3nd-core/url.ts`](../libs/b3nd-core/url.ts).
> Helpers (`count`, `list`, `listUris`, `x`) build the strings; you just need to
> parse them on the way in.

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
  read<T>(urls: string[]): Promise<ReadResult<T>[]>;
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
  read<T>(urls: string[]): Promise<ReadResult<T>[]>;
  observe(urls: string[], signal: AbortSignal): AsyncIterable<ObserveEvent>;
  status(): Promise<StatusResult>;
}
```

The rest of this doc focuses on `read`; observe is INV-style and documented in
the README.

---

## 2. The `read(urls)` contract

```ts
read<T>(urls: string[]): Promise<ReadResult<T>[]>
```

- **Input**: an ordered batch of url strings.
- **Output**: `ReadResult[]` in input order. _The result count may exceed the
  input count_ — `fn=ls` expands one prefix into many results, all of which
  appear before the next input's results.
- **Per-url failures are results, not throws.** Return
  `{ success: false, error: "…" }`. Throw only on unrecoverable transport errors
  (the rig will surface those as a batch failure).
- **Empty input** is valid — return `[]`.

### Result shape per `fn`

| `fn`    | Shape per result                                                       |
| ------- | ---------------------------------------------------------------------- |
| `read`  | exactly one; `success` + `record.data` _or_ `success: false`           |
| `ls`    | zero or more; `uri` always set; `record` present iff `format=full`     |
| `count` | exactly one; `record.data: number`                                     |
| `x-*.*` | provider-defined; recommend matching one of the above unless necessary |

For `fn=ls`, the per-item `uri` should be the absolute uri of the matched entry,
not relative.

---

## 3. The dispatch pattern

The standard implementation is a switch on `fn`:

```ts
import { parseUrl } from "@bandeira-tech/b3nd-core/url";

async read<T>(urls: string[]): Promise<ReadResult<T>[]> {
  const out: ReadResult<T>[] = [];
  for (const url of urls) {
    const parsed = parseUrl(url);
    switch (parsed.fn) {
      case "read":  out.push(this.readOne<T>(parsed.uri)); break;
      case "ls":    out.push(...this.list<T>(parsed));     break;
      case "count": out.push(this.count(parsed));          break;
      default:
        // x-*.* or anything we don't know — return a failure result,
        // do not throw.
        out.push({
          success: false,
          error: `MyStore: unsupported fn '${parsed.fn}'`,
        });
    }
  }
  return out;
}
```

`parseUrl` returns:

```ts
interface ParsedUrl {
  uri: string; // address (no query)
  fn: string; // 'read' | 'ls' | 'count' | 'x-...'
  params: ReadParams; // typed standard params (see below)
  ext: Record<string, string>; // x-* extension bag
}
```

If a url has no explicit `fn=`, the default is `read` (or `ls` when the uri ends
in `/`). If the url's `limit` or `page` is malformed, `parseUrl` throws — that's
a programmer error, let it propagate.

---

## 4. Standard parameters

Spec'd by the framework — every backend should accept these meanings when
applicable:

| Param    | Type     | Notes                                                   |
| -------- | -------- | ------------------------------------------------------- |
| `format` | `string` | For `fn=ls`: `'full'` (default) or `'uris'` (no record) |
| `limit`  | `number` | Max items returned                                      |
| `page`   | `number` | Page number — **convention**, see below                 |

Open — interpreted per backend, **throw or fail-result on unsupported values**.
Don't silently ignore:

| Param       | Type     | Notes                                   |
| ----------- | -------- | --------------------------------------- |
| `pattern`   | `string` | Glob, regex, substring — your call      |
| `sortBy`    | `string` | `uri`, `timestamp`, your column name, … |
| `sortOrder` | `string` | `asc` or `desc` by convention           |
| `cursor`    | `string` | Opaque pagination cursor                |

### Convention: `page` indexing

`page` is **1-indexed** by convention (page=1 is the first page). Backends are
free to support 0-indexed too, but the helpers (`list(uri, {page: 1})`) and the
reference `MemoryStore` assume 1-indexed.

### Failure on unsupported params

If a caller asks for `pattern: "foo*"` and you don't support globs, return one
failure result for that url:

```ts
return [{
  success: false,
  error: "MyStore: pattern matching is not supported",
}];
```

Don't return a misleading "success with empty results" — that hides the bug from
the caller.

---

## 5. Extensions: `x-*` functions and params

If your backend wants to expose something the standard fns don't cover — a
recursive `scan`, a fan-out `aggregate`, a keyspace cursor, a database-specific
predicate — namespace it.

### `x-*` function names

Format: `x-<ns>.<name>`. The `<ns>` is your store/protocol slug; the `<name>` is
the operation.

```ts
import { x } from "@bandeira-tech/b3nd-core/url";

const url = x("mutable://users/", "x-pg.scan", {
  limit: 100,
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

## 7. Failure semantics — when to throw, when to return

| Situation                                          | Action                                            |
| -------------------------------------------------- | ------------------------------------------------- |
| One url failed, others fine                        | Return per-url `{ success: false, error: "…" }`   |
| Caller asked for an unsupported `fn` or param      | Return per-url `{ success: false, error: "…" }`   |
| Transport broke (DB connection lost, network down) | **Throw** — the rig propagates as a batch failure |
| Empty result for a `fn=ls` over a missing prefix   | Return `[]` (zero items, not a failure)           |
| Empty result for `fn=count` over a missing prefix  | Return `{ success: true, record: { data: 0 } }`   |
| `fn=read` on a missing uri                         | Return `{ success: false, error: "Not found" }`   |

The rule of thumb: **the batch is one transaction with the network**. If you can
answer some urls but not others, answer them. Only throw when you can't answer
_any_.

---

## 8. A 50-line worked example

```ts
import { parseUrl } from "@bandeira-tech/b3nd-core/url";
import type {
  ParsedUrl,
  ReadResult,
  StatusResult,
  Store,
  StoreEntry,
  StoreWriteResult,
} from "@bandeira-tech/b3nd-core";

class MyStore implements Store {
  private kv = new Map<string, { data: unknown }>();

  write(entries: StoreEntry[]): Promise<StoreWriteResult[]> {
    for (const e of entries) this.kv.set(e.uri, { data: e.data });
    return Promise.resolve(entries.map(() => ({ success: true })));
  }

  read<T>(urls: string[]): Promise<ReadResult<T>[]> {
    const out: ReadResult<T>[] = [];
    for (const url of urls) {
      const p = parseUrl(url);
      switch (p.fn) {
        case "read": {
          const r = this.kv.get(p.uri);
          out.push(
            r
              ? { success: true, record: r as { data: T } }
              : { success: false, error: "Not found" },
          );
          break;
        }
        case "ls":
          out.push(...this.ls<T>(p));
          break;
        case "count":
          out.push(this.count(p) as ReadResult<T>);
          break;
        default:
          out.push({
            success: false,
            error: `MyStore: unsupported fn '${p.fn}'`,
          });
      }
    }
    return Promise.resolve(out);
  }

  private ls<T>(p: ParsedUrl): ReadResult<T>[] {
    if (p.params.pattern !== undefined) {
      return [{ success: false, error: "MyStore: pattern not supported" }];
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
    return entries.map(([uri, record]) =>
      format === "uris"
        ? { success: true, uri }
        : { success: true, uri, record: record as { data: T } }
    );
  }

  private count(p: ParsedUrl): ReadResult<number> {
    const prefix = p.uri.endsWith("/") ? p.uri : `${p.uri}/`;
    const n = [...this.kv.keys()].filter((k) => k.startsWith(prefix)).length;
    return { success: true, record: { data: n } };
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
slightly fuller version of this pattern — read it for a working example with
sort/limit/page tested against the shared store suite.

---

## 9. What the rig promises and doesn't

The rig will:

- Route urls to the first connection whose pattern accepts the routing key.
- Run `beforeRead` / `afterRead` hooks per url with the parsed
  `{ url, uri, fn, params, ext }`.
- Re-serialize the url from the hook's returned ctx (so a hook can rewrite `fn`
  or params) before dispatch.
- Fire `read:success` / `read:error` events.
- Multiplex observe streams across multiple matching connections.

The rig will **not**:

- Validate `fn` against advertised `fns` — that's your job.
- Fall through to the next connection on a `success: false` — composing
  fall-through is an aggregating client's job.
- Aggregate results across connections (sum counts, dedup ls items, …) — same.
- Retry, timeout, or rate-limit at the rig level — wrap your client.

---

## 10. Tests for free

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

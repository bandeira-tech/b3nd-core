# Chapter 2 — Hello, data

> The smallest useful thing: a Canon, a Domain PIN that stores it, and a bare
> Rig that routes one write and one read.

We start data-first. Before any rules, before any behavior, we decide two
things: **what a profile is** and **how it is addressed**. That's a Canon.

## 1. The Canon

A Canon is pure TypeScript — types, URI builders, a validator. No imports from
the rig, no I/O.

```ts
// chirp/canon/profiles.ts

/** The data model. */
export interface Profile {
  handle: string;       // "alice"
  displayName: string;  // "Alice"
  bio?: string;
}

/** The addressing. Every Canon owns one URI sub-space. */
export const Profiles = {
  /** Canonical URI for one profile. */
  uri: (handle: string): string => `chirp://profiles/${handle}`,

  /** The glob pattern for "every profile" — used in routes/reactions. */
  pattern: "chirp://profiles/*",

  /** Recover the handle from a URI (patterns are bool-only, no captures). */
  handleOf: (uri: string): string => uri.slice("chirp://profiles/".length),

  /** Validator: throw on a malformed payload. Pure. */
  parse(payload: unknown): Profile {
    const p = payload as Partial<Profile>;
    if (typeof p?.handle !== "string" || p.handle.length === 0) {
      throw new Error("Profile.handle is required");
    }
    if (typeof p?.displayName !== "string" || p.displayName.length === 0) {
      throw new Error("Profile.displayName is required");
    }
    return { handle: p.handle, displayName: p.displayName, bio: p.bio };
  },
} as const;
```

That's the entire data layer for profiles. Notice it knows nothing about
storage or the rig. You could publish this on its own; everything above depends
*down* onto it and it depends on nothing.

## 2. The Domain PIN

Now, somewhere to put profiles. A Domain PIN implements
`ProtocolInterfaceNode`. The simplest possible one is an in-memory map. We
extend `ObserveEmitter` so we get a working `observe()` for free (we'll use it
in later chapters); for now we only exercise `receive` and `read`.

```ts
// chirp/stores/memory.ts
import { ObserveEmitter } from "@bandeira-tech/b3nd-core";
import type { Output, ReceiveResult, StatusResult } from "@bandeira-tech/b3nd-core";

/** A trivial KV Domain PIN: exact-uri reads, in-memory. */
export class MemoryStore extends ObserveEmitter {
  private store = new Map<string, unknown>();

  receive(msgs: Output[]): Promise<ReceiveResult[]> {
    return Promise.resolve(
      msgs.map(([uri, payload]) => {
        this.store.set(uri, payload);
        this._emit(uri, payload); // notify observers (Ch 5)
        return { accepted: true };
      }),
    );
  }

  // 1:1 with input. A miss is `undefined` — our chosen convention.
  read<T = unknown>(locators: string[]): Promise<Output<T>[]> {
    return Promise.resolve(
      locators.map((l): Output<T> => [l, this.store.get(l) as T]),
    );
  }

  status(): Promise<StatusResult> {
    return Promise.resolve({ status: "healthy", fns: ["read"] });
  }
}
```

Two contract notes that matter and never stop mattering:

- **`read` is 1:1 with its input.** One `[locator, payload]` tuple per locator,
  in order. A miss is *not* an error — here it's `undefined`, by our convention.
- **`receive` returns one `ReceiveResult` per input**, `{ accepted: true }` on
  success.

> No query grammar. Core used to ship a `?fn=ls&...` URL grammar; it was
> **removed** (`refactor!: drop url grammar from core`). Locators are now opaque
> strings whose meaning is a contract between caller and client. Our store only
> understands exact URIs. When we need listing/feeds (Ch 4) we won't reach for
> a query language — we'll **derive read-models with reactions**. That's the
> idiomatic b3nd move.

## 3. The bare Rig

A `Rig` is pure orchestration. You build clients outside and hand them in via
`routes`. `connection(client, patterns)` binds our store to the profile URIs.

```ts
// chirp/node.ts
import { connection, Rig } from "@bandeira-tech/b3nd-core";
import { MemoryStore } from "./stores/memory.ts";
import { Profiles, type Profile } from "./canon/profiles.ts";

const store = new MemoryStore();
const profiles = connection(store, [Profiles.pattern]);

const rig = new Rig({
  routes: {
    receive: [profiles],
    read:    [profiles],
    observe: [profiles],
  },
});
```

## 4. Write and read

```ts
// Write a profile (host application accepts state → receive).
await rig.receive([
  [Profiles.uri("alice"), { handle: "alice", displayName: "Alice" } satisfies Profile],
]);

// Read it back. read() is 1:1 with input.
const [out] = await rig.read([Profiles.uri("alice")]);
out?.[1]; // { handle: "alice", displayName: "Alice" }
```

That's the full loop on the smallest possible system: **Canon → Domain PIN →
Rig → write → read.** No rules yet — `rig.receive` will store *anything*
matching the pattern, including a malformed profile. We deliberately have no
validation. That's the job of the next layer.

> **`receive` vs `send`.** The Rig exposes two write actions. `receive` =
> "accept state from elsewhere" (what we used). `send` = "this host originates
> this state". They run the same pipeline; the distinction matters for hooks
> (`beforeReceive` vs `beforeSend`) and for network replication (Ch 7). For a
> local write either works; we'll use `receive` as the default ingestion path.

In [Chapter 3](./03-your-first-app.md) we add the `posts` Canon and turn that
"stores anything" gap into a real rule — our first **App**.
</content>

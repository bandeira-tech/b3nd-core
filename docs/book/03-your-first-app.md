# Chapter 3 — Your first App

> A Program classifies a write; a handler decides what the classification
> *does*. Bundle them with their routes and you have an App.

In Chapter 2 the rig stored anything. Now we add the `posts` Canon and make the
system *refuse* a bad post. The mechanism is core's classify-then-handle
pipeline, and the packaging is the **App**.

## 1. The posts Canon

```ts
// chirp/canon/posts.ts
export interface Post {
  id: string;
  author: string;   // a profile handle
  text: string;
  ts: number;       // epoch ms
}

export const Posts = {
  uri: (id: string): string => `chirp://posts/${id}`,
  pattern: "chirp://posts/*",
  idOf: (uri: string): string => uri.slice("chirp://posts/".length),

  /** Pure validity check. Returns a reason, or null when valid. */
  invalidReason(payload: unknown): string | null {
    const p = payload as Partial<Post>;
    if (typeof p?.author !== "string" || !p.author) return "author required";
    if (typeof p?.text !== "string" || !p.text)     return "text required";
    if (p.text.length > 280)                          return "text too long";
    return null;
  },
} as const;
```

## 2. The Program — classify, don't decide

A `Program` is a **pure classifier**. It looks at the `Output` being written
and returns a `code` string. It does not store anything and does not reject by
itself — it just names what kind of write this is.

```ts
// chirp/apps/posts/program.ts
import type { Program } from "@bandeira-tech/b3nd-core";
import { Posts } from "../../canon/posts.ts";

// Program signature: (output, upstream, read) => Promise<{ code, error? }>
export const classifyPost: Program = async (output) => {
  const [, payload] = output;               // output is the tuple [uri, payload]
  const reason = Posts.invalidReason(payload);
  return reason
    ? { code: "post:rejected", error: reason }
    : { code: "post:valid" };
};
```

Programs are registered under a **URI prefix**; the rig runs the program whose
prefix matches the write's URI.

## 3. The handlers — what each code means

A `CodeHandler` takes the classified `Output` and returns the `Output[]` to
actually dispatch to the routes. Persisting is "return the tuple"; refusing is
"return nothing".

```ts
// chirp/apps/posts/handlers.ts
import type { CodeHandler } from "@bandeira-tech/b3nd-core";

// Persist the post as-is.
export const persistPost: CodeHandler = async (out) => [out];

// Refuse: emit nothing. The write is dropped before it reaches storage.
export const dropPost: CodeHandler = async () => [];
```

> The handler receives an `Output` **tuple** `[uri, payload]` — destructure it,
> e.g. `const [uri, payload] = out`. (Some snippets elsewhere show `out.payload`;
> that's not the real shape.)

## 4. The App — bundle behavior with its routes

An **App** is a named object carrying a slice of rig config. It wires the
Domain PIN into routes and registers the program + handlers — all scoped to the
`posts` URI space. We make it a *factory* so the store is injected (the App
doesn't care which Domain PIN backs it).

```ts
// chirp/apps/posts/app.ts
import { connection } from "@bandeira-tech/b3nd-core";
import type { ProtocolInterfaceNode } from "@bandeira-tech/b3nd-core";
import type { App } from "../../app.ts"; // the primitive — see Chapter 8
import { Posts } from "../../canon/posts.ts";
import { classifyPost } from "./program.ts";
import { persistPost, dropPost } from "./handlers.ts";

export const postsApp = (store: ProtocolInterfaceNode): App => {
  const node = connection(store, [Posts.pattern]);
  return {
    name: "posts",
    routes: { receive: [node], read: [node], observe: [node] },
    programs: { "chirp://posts": classifyPost },
    handlers: {
      "post:valid":    persistPost,
      "post:rejected": dropPost,
    },
  };
};
```

That's the whole App. Read it top to bottom and it tells you everything this
behavior does: it serves `chirp://posts/*`, classifies writes there, persists
valid ones, drops invalid ones.

## 5. Mount it

Even with one App we go through `composeApps` — it's the only way config enters
the Rig from here on, and it gives us collision-checking and hook-chaining for
free (Chapter 8 has the source).

```ts
// chirp/node.ts
import { Rig } from "@bandeira-tech/b3nd-core";
import { composeApps } from "./app.ts";
import { MemoryStore } from "./stores/memory.ts";
import { postsApp } from "./apps/posts/app.ts";
import { Posts } from "./canon/posts.ts";

const store = new MemoryStore();
const rig = new Rig(composeApps([postsApp(store)]));

// A valid post is stored.
await rig.receive([[Posts.uri("p1"), { id: "p1", author: "alice", text: "hi", ts: Date.now() }]]);
const [p1] = await rig.read([Posts.uri("p1")]);
p1?.[1]; // { id: "p1", author: "alice", text: "hi", ts: ... }

// An invalid post (empty text) is classified `post:rejected` → dropped.
await rig.receive([[Posts.uri("p2"), { id: "p2", author: "alice", text: "", ts: Date.now() }]]);
const [p2] = await rig.read([Posts.uri("p2")]);
p2?.[1]; // undefined — never persisted
```

## Program-and-handler, or just a hook?

You'll wonder when to validate with a **program/handler** versus a
**`beforeReceive` hook** (Chapter 6). Rule of thumb:

- **Program/handler** when the decision is part of the *domain* and may produce
  *more than one outcome* or *transform* the write (persist, refuse, decompose
  into several tuples, rewrite the payload). It's the data's own logic.
- **Hook** when the gate is *cross-cutting policy* that doesn't belong to any
  one Canon — auth, rate limits, audit. Hooks throw to reject and are the same
  for every URI they cover.

Posts validity is domain logic, so it lives in the App's program. Good.

We now have a node that knows what a valid post is. In
[Chapter 4](./04-reactions-and-events.md) we make writes *cause* things —
counters, feeds, notifications — without a query language, using reactions.
</content>

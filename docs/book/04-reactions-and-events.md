# Chapter 4 — Reactions & events

> A write can *cause* more writes. That's how you maintain counters, feeds, and
> notifications in a system with no query language.

Core has no `SELECT`. A `read` returns exactly the URIs you ask for. So how do
you answer "how many likes does p1 have?" or "show me alice's latest posts"?
You **don't query — you maintain**. On every relevant write, a **reaction**
updates a derived **read-model**: a plain URI whose payload is the answer,
already computed. This chapter adds likes, a like-count, a per-author feed
index, and a notification — all with reactions.

## 1. Likes Canon

```ts
// chirp/canon/likes.ts
export const Likes = {
  // One like = one URI. Presence is the like.
  uri: (postId: string, handle: string): string =>
    `chirp://posts/${postId}/likes/${handle}`,
  pattern: "chirp://posts/*/likes/*",

  // The derived read-model: the count, addressed by its own URI.
  countUri: (postId: string): string => `chirp://posts/${postId}/likeCount`,

  postIdOf: (uri: string): string => uri.split("/")[3], // chirp://posts/<id>/likes/<h>
} as const;
```

Note the **count is just another URI** (`chirp://posts/p1/likeCount`) whose
payload is a number. Reading the count is then an ordinary exact read — no
aggregation at read time.

## 2. A reaction maintains the count

A `Reaction` fires after a successful write whose URI matches its pattern. It
receives the written `Output` tuple and a `read` function, and returns the
`Output[]` to emit as a consequence. Those emitted tuples flow back through the
**full pipeline** (`rig.send`) — programs, handlers, even more reactions.

```ts
// chirp/apps/likes/reactions.ts
import type { Reaction } from "@bandeira-tech/b3nd-core";
import { Likes } from "../../canon/likes.ts";

// On every like write, recompute and store the count.
export const bumpLikeCount: Reaction = async (out, read) => {
  const [uri] = out;
  const postId = Likes.postIdOf(uri);

  // Read the current count (miss → undefined → treat as 0) and increment.
  const [current] = await read<number>(Likes.countUri(postId));
  const next = (current?.[1] ?? 0) + 1;

  return [[Likes.countUri(postId), next]];
};
```

> Reactions are **fire-and-forget** and run *after* the triggering write lands.
> Their emissions are a fresh operation, not part of the original ack. If a
> reaction throws, it surfaces as a `reaction:error` on the operation handle and
> via `onError` (Chapter 6) — it does not roll back the write that triggered it.
> Keep them idempotent-friendly where you can; here, "increment" is naive on
> purpose — Chapter 7 discusses convergence under replication.

## 3. A reaction maintains a feed index

To answer "alice's latest post ids" without a query language, keep an explicit
list at a known URI and append to it on every post.

```ts
// chirp/apps/posts/feed-reaction.ts
import type { Reaction } from "@bandeira-tech/b3nd-core";
import { Posts } from "../../canon/posts.ts";

const feedUri = (author: string) => `chirp://feeds/${author}`;

export const appendToFeed: Reaction = async (out, read) => {
  const [uri, payload] = out;
  const post = payload as { author: string };
  const id = Posts.idOf(uri);

  const [existing] = await read<string[]>(feedUri(post.author));
  const ids = [id, ...(existing?.[1] ?? [])].slice(0, 100); // newest-first, capped

  return [[feedUri(post.author), ids]];
};
```

Now "first paint of @alice" is two exact reads — the feed list, then the posts
it names — exactly the round-trip shape the cookbook describes, but built from
maintained read-models instead of a query grammar.

## 4. Events — async side-effects that don't emit

Reactions emit more `Output`. **Events** are for effects that *leave* the
system — metrics, logs, pushing a notification to an external service. They are
async, fire-and-forget, and never block the caller. Register them per operation
outcome.

```ts
// chirp/apps/posts/events.ts
import type { EventHandler } from "@bandeira-tech/b3nd-core";

export const countPost: EventHandler = () => metrics.increment("chirp.posts.received");
export const alertOnError: EventHandler = () => metrics.increment("chirp.errors");
```

## 5. Fold it into the Apps

Reactions and events are just more fields on the App. Likes get their own App;
the feed reaction belongs to the posts App (it reacts to post writes).

```ts
// chirp/apps/likes/app.ts
import { connection } from "@bandeira-tech/b3nd-core";
import type { App } from "../../app.ts";
import { Likes } from "../../canon/likes.ts";
import { bumpLikeCount } from "./reactions.ts";

export const likesApp = (store): App => {
  const node = connection(store, [Likes.pattern, "chirp://posts/*/likeCount"]);
  return {
    name: "likes",
    routes: { receive: [node], read: [node], observe: [node] },
    reactions: { [Likes.pattern]: bumpLikeCount },
  };
};
```

```ts
// posts App, extended
export const postsApp = (store): App => {
  const node = connection(store, [Posts.pattern, "chirp://feeds/*"]);
  return {
    name: "posts",
    routes: { receive: [node], read: [node], observe: [node] },
    programs: { "chirp://posts": classifyPost },
    handlers: { "post:valid": persistPost, "post:rejected": dropPost },
    reactions: { [Posts.pattern]: appendToFeed },
    on: { "receive:success": [countPost], "*:error": [alertOnError] },
  };
};
```

## In action

```ts
const rig = new Rig(composeApps([postsApp(store), likesApp(store)]));

await rig.receive([[Posts.uri("p1"), { id: "p1", author: "alice", text: "hi", ts: Date.now() }]]);
await rig.receive([[Likes.uri("p1", "bob"),     true]]);
await rig.receive([[Likes.uri("p1", "carol"),   true]]);

const [count] = await rig.read([Likes.countUri("p1")]);
count?.[1]; // 2  — maintained by the reaction, read as an ordinary URI

const [feed] = await rig.read(["chirp://feeds/alice"]);
feed?.[1]; // ["p1"]
```

Reactions turned a system that can only fetch-by-URI into one with feeds and
counts — and every derived value is itself a plain, observable URI. Speaking of
observable: in [Chapter 5](./05-composing-apps.md) we add more behaviors,
compose several Apps into one node, and watch changes stream out with
`observe`.
</content>

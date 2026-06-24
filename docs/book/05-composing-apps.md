# Chapter 5 — Composing Apps

> Many behaviors, one node. This is the payoff: independently-authored Apps
> merged into a single Rig that serves all of them.

So far we've quietly used `composeApps` with one or two Apps. Now we lean on it.
We'll add a `follows` behavior and a `moderation` behavior, then compose four
Apps into one node — and see what `composeApps` does when two Apps disagree.

## 1. A follows App

```ts
// chirp/canon/follows.ts
export const Follows = {
  // alice follows bob → chirp://follows/alice/bob
  uri: (from: string, to: string): string => `chirp://follows/${from}/${to}`,
  pattern: "chirp://follows/*/*",
  parts: (uri: string) => { const s = uri.split("/"); return { from: s[3], to: s[4] }; },
} as const;
```

```ts
// chirp/apps/follows/app.ts
import { connection } from "@bandeira-tech/b3nd-core";
import type { App } from "../../app.ts";
import type { Reaction } from "@bandeira-tech/b3nd-core";
import { Follows } from "../../canon/follows.ts";

// On a new follow, drop a notification for the followee.
const notifyFollowee: Reaction = async (out) => {
  const { from, to } = Follows.parts(out[0]);
  return [[`chirp://notifications/${to}`, { kind: "new-follower", from, ts: Date.now() }]];
};

export const followsApp = (store): App => {
  const node = connection(store, [Follows.pattern]);
  const notes = connection(store, ["chirp://notifications/*"]);
  return {
    name: "follows",
    routes: { receive: [node, notes], read: [node, notes], observe: [node, notes] },
    reactions: { [Follows.pattern]: notifyFollowee },
  };
};
```

This App was written without any knowledge of posts or likes. It owns
`chirp://follows/*/*` and `chirp://notifications/*` and nothing else. That
isolation is the whole point.

## 2. A moderation App — a *cross-cutting* behavior

Moderation is interesting because it reacts to writes in *another* App's
namespace (`chirp://posts/*`) without owning storage there. It hides flagged
posts by maintaining a moderation read-model.

```ts
// chirp/apps/moderation/app.ts
import { connection } from "@bandeira-tech/b3nd-core";
import type { App, Reaction } from "@bandeira-tech/b3nd-core";

const BANNED = ["spam", "scam"];

const flagPost: Reaction = async (out) => {
  const [uri, payload] = out;
  const text = (payload as { text?: string }).text ?? "";
  const flagged = BANNED.some((w) => text.toLowerCase().includes(w));
  return flagged ? [[`chirp://moderation/${uri.split("/")[3]}`, { hidden: true }]] : [];
};

export const moderationApp = (store): App => ({
  name: "moderation",
  // It only *stores* under its own namespace…
  routes: {
    receive: [connection(store, ["chirp://moderation/*"])],
    read:    [connection(store, ["chirp://moderation/*"])],
  },
  // …but it *reacts* to writes in the posts namespace.
  reactions: { "chirp://posts/*": flagPost },
});
```

> **Reacting across namespaces is fine; storing across them is not.** A
> reaction may *observe* any URI pattern and emit consequences into its own
> namespace. What an App must not do is claim *routes* or *programs* over a
> Canon it doesn't own — that's the collision `composeApps` guards against next.

## 3. Compose the node

```ts
import { Rig } from "@bandeira-tech/b3nd-core";
import { composeApps } from "./app.ts";

const store = new MemoryStore();

const rig = new Rig(composeApps([
  profilesApp(store),
  postsApp(store),
  likesApp(store),
  followsApp(store),
  moderationApp(store),
]));
```

One `Rig`. Five behaviors. Each contributed its routes, programs, handlers, and
reactions; `composeApps` concatenated the routes (preserving order, so
first-match-wins on `read` still holds) and key-merged the rest.

## 4. What collisions look like

`composeApps` **throws on a duplicated program / handler / reaction key**. If a
second App also tried to own `chirp://posts`:

```ts
const rogue: App = { name: "rogue", programs: { "chirp://posts": somethingElse } };

new Rig(composeApps([postsApp(store), rogue]));
// throws:
// composeApps: program "chirp://posts" claimed by two apps (offending: "rogue")
```

This is deliberate. Two Apps silently fighting over the same URI prefix is a
class of bug you want at *startup*, not in production. If you genuinely want two
handlers for one event, that's what the `on` event arrays are for (they
concatenate) — or compose the logic into a single program. (See Chapter 8 for
the exact merge rules per field.)

## 5. Observe the whole node

Because every derived value is a plain URI, you can subscribe to changes across
*all* behaviors with one `observe`. The stream yields batches of URIs that
changed; you read each to learn its state (INV-style).

```ts
const ac = new AbortController();
(async () => {
  for await (const uris of rig.observe(["chirp://**"], ac.signal)) {
    const outs = await rig.read([...uris]);
    for (const [uri, payload] of outs) console.log("changed:", uri, payload);
  }
})();

await rig.receive([[Posts.uri("p9"), { id: "p9", author: "alice", text: "spam offer", ts: Date.now() }]]);
// observer sees, in some order:
//   chirp://posts/p9            { ...the post }
//   chirp://feeds/alice         ["p9", ...]        (posts App reaction)
//   chirp://moderation/p9       { hidden: true }   (moderation App reaction)
```

Three Apps reacted to one write, and a single observer saw the ripple — without
any App knowing about the others. That's composition: behaviors that were
written, tested, and shipped independently, cooperating through nothing but
shared URIs.

Next, in [Chapter 6](./06-policy-and-identity.md), we add the concerns that
*span* every App — authentication and rate limiting — as composed hooks, and
sign writes with `Identity`.
</content>

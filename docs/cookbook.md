# Read-url cookbook

Real-world flows expressed as `pin.read([…])` batches. The patterns here use
Instagram as an example app, but the shapes apply to any content-addressed
system.

> Helpers used in the snippets:
>
> ```ts
> import { count, list, listUris, x } from "@bandeira-tech/b3nd-core/url";
> ```

---

## Profile screen first paint

User taps `@alice`. The screen needs the profile blob, the post-count badge, and
the first 12 thumbnail uris (the grid resolves them lazily). Three intents, one
round-trip:

```ts
const [profile, total, ...grid] = await pin.read([
  "instagram://users/alice",
  count("instagram://users/alice/posts/"),
  listUris("instagram://users/alice/posts/", {
    limit: 12,
    sortBy: "timestamp",
    sortOrder: "desc",
  }),
]);

profile.record?.data; // { name, avatar, … }
total.record?.data; // 4127
grid.map((r) => r.uri); // ["instagram://users/alice/posts/p1", …]
```

Why this is good: the underlying transport sees one POST. The grid items came
back as uris with no payloads — the thumbnails fetch themselves when they enter
the viewport.

---

## Comments tab with per-comment reply counts

Open post `p123`, page 1 of comments (20 newest), plus a "View replies (N)"
badge per comment. The reply counts are heterogeneous — different prefixes, all
counts.

```ts
// First batch: total + page of comments (one round-trip).
// `count` produces one result; `list` expands inline to N items —
// destructure: total = count, page = the ls items.
const [total, ...page] = await pin.read([
  count("instagram://posts/p123/comments/"),
  list("instagram://posts/p123/comments/", {
    limit: 20,
    page: 1,
    sortBy: "timestamp",
    sortOrder: "desc",
  }),
]);

// Second batch: a count per comment, all in one round-trip.
const counts = await pin.read(
  page.map((c) => count(`${c.uri!}/replies/`)),
);

const replies = Object.fromEntries(
  page.map((c, i) => [c.uri, counts[i].record!.data as number]),
);
// { "instagram://posts/p123/comments/c456": 12, … }
```

---

## Hashtag explore with infinite-scroll cursor

`#coffee` feed ranked by engagement, served by an `instagram-feed` backend that
exposes a custom `x-feed.rank` function with a cursor extension.

```ts
// Page 1.
const page1 = await pin.read([
  x("instagram://hashtags/coffee/", "x-feed.rank", {
    limit: 30,
    ext: { "x-feed.algo": "engagement" },
  }),
]);

// The backend stashes the cursor in the last item's errorDetail
// (one of several conventions; check your backend's docs).
const cursor = page1.at(-1)?.errorDetail?.details as string | undefined;

// Page 2.
const page2 = await pin.read([
  x("instagram://hashtags/coffee/", "x-feed.rank", {
    limit: 30,
    ext: {
      "x-feed.algo": "engagement",
      "x-feed.cursor": cursor!,
    },
  }),
]);
```

The cursor lives in the url, which means a deep-linkable feed page just works:
`instagram://hashtags/coffee/?fn=x-feed.rank&x-feed.cursor=…`.

---

## Watch a uri for changes

Observe is INV-style — it tells you a uri changed; you read the uri to learn the
new state. This composes naturally with the read API:

```ts
const ac = new AbortController();
for await (
  const ev of pin.observe(["instagram://posts/p123/likes/*"], ac.signal)
) {
  // Pull the count after a like is added or removed.
  const [c] = await pin.read([count("instagram://posts/p123/likes/")]);
  ui.setLikeCount(c.record!.data as number);
}
```

The backend doesn't have to push count-deltas — it just announces that a uri
under the prefix changed and the reader recalculates.

---

## Hook-based policy enforcement

A `beforeRead` hook can inspect or rewrite any read request. Useful for
sandboxing, rate-limiting, or enforcing payload-free reads.

```ts
const rig = new Rig({
  routes: {/* … */},
  hooks: {
    beforeRead: (ctx) => {
      // Force every ls to be uri-only (no payload leaks to the bus).
      if (ctx.fn === "ls") {
        return {
          ctx: {
            ...ctx,
            params: { ...ctx.params, format: "uris" },
          },
        };
      }
    },
  },
});
```

The rig re-serializes the url from the returned ctx via `buildUrl` before
dispatching to the connection — so the rewritten params reach the executing
client.

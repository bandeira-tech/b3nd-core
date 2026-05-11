# Read-url cookbook

Real-world flows expressed as `pin.read([…])` batches. The patterns here use
Instagram as an example app, but the shapes apply to any content-addressed
system.

> **Shape recap.** `pin.read(urls)` returns `Output[]` **1:1 with input urls**:
> one `[inputUrl, payload]` slot per request. The payload shape depends on the
> requested `fn`:
>
> - `fn=read` → the stored value (or whatever the protocol returns for a miss)
> - `fn=ls&format=full` → `Output<T>[]` (entries under the prefix)
> - `fn=ls&format=uris` → `string[]` (flat list of entry uris)
> - `fn=count` → `number`
> - `fn=x-…` → provider-defined
>
> The url grammar is `<uri>[?fn=…&param=value…]`. Trailing slash defaults to
> `fn=ls`. Write urls inline — there are no builders to import.

---

## Profile screen first paint

User taps `@alice`. The screen needs the profile blob, the post-count badge, and
the first 12 thumbnail uris (the grid resolves them lazily). Three intents, one
round-trip — positional destructuring matches input order:

```ts
const [profile, total, grid] = await pin.read([
  "instagram://users/alice",
  "instagram://users/alice/posts/?fn=count",
  "instagram://users/alice/posts/?format=uris&limit=12&sortBy=timestamp&sortOrder=desc",
]);

profile?.[1]; // { name, avatar, … } | undefined
total?.[1]; // 4127  — payload is the count, addressed under the request url
const uris = grid?.[1] as string[];
uris; // ["instagram://users/alice/posts/p1", …]
```

Why this is good: the underlying transport sees one POST. The grid's payload is
a flat list of uris (`format=uris`) — no inner tuples to unwrap. The viewport
fetches each uri when needed.

---

## Comments tab with per-comment reply counts

Open post `p123`, page 1 of comments (20 newest), plus a "View replies (N)"
badge per comment.

```ts
// First batch: total + page of comments (one round-trip).
const [totalOut, pageOut] = await pin.read([
  "instagram://posts/p123/comments/?fn=count",
  "instagram://posts/p123/comments/?limit=20&page=1&sortBy=timestamp&sortOrder=desc",
]);

const total = totalOut?.[1] as number;
const page = (pageOut?.[1] ?? []) as Array<[string, unknown]>;

// Second batch: a count per comment, all in one round-trip.
const counts = await pin.read(
  page.map(([uri]) => `${uri}/replies/?fn=count`),
);

const replies = Object.fromEntries(
  page.map(([uri], i) => [uri, counts[i]?.[1] as number]),
);
// { "instagram://posts/p123/comments/c456": 12, … }
```

---

## Hashtag explore with infinite-scroll cursor

`#coffee` feed ranked by engagement, served by an `instagram-feed` backend that
exposes a custom `x-feed.rank` function with a cursor extension.

```ts
import { buildUrl } from "@bandeira-tech/b3nd-core/url";

// Page 1. `fn=x-feed.rank` returns its provider-defined payload —
// here, the backend chooses `Output[]` with feed items plus a cursor
// item under its own b3nd:// namespace.
const [page1Out] = await pin.read([
  buildUrl({
    uri: "instagram://hashtags/coffee/",
    fn: "x-feed.rank",
    params: { limit: 30 },
    ext: { "x-feed.algo": "engagement" },
  }),
]);
const page1 = (page1Out?.[1] ?? []) as Array<[string, unknown]>;

// Find the cursor item by uri prefix.
const cursorOut = page1.find(([uri]) =>
  uri.startsWith("b3nd://x-feed/cursor/")
);
const cursor = cursorOut?.[1] as string | undefined;

// Page 2.
const [page2Out] = await pin.read([
  buildUrl({
    uri: "instagram://hashtags/coffee/",
    fn: "x-feed.rank",
    params: { limit: 30 },
    ext: {
      "x-feed.algo": "engagement",
      ...(cursor ? { "x-feed.cursor": cursor } : {}),
    },
  }),
]);
```

The cursor lives in the url, which means a deep-linkable feed page just works:
`instagram://hashtags/coffee/?fn=x-feed.rank&x-feed.cursor=…`.

---

## Watch a uri for changes

Observe yields `Output<string[]>` packages — `[inputUrl, uris]` — INV-style. The
first element echoes the subscription url that matched (so a single
`observe([a, b])` call can dispatch by `a` vs `b`); the second is the list of
uris that fired in this batch.

```ts
const ac = new AbortController();
for await (
  const [, uris] of pin.observe(["instagram://posts/p123/likes/*"], ac.signal)
) {
  // The likes prefix changed; recompute the count.
  const [c] = await pin.read(["instagram://posts/p123/likes/?fn=count"]);
  ui.setLikeCount(c?.[1] as number);
}
```

The backend doesn't have to push count-deltas — it just announces which uris
under the prefix changed and the reader recalculates.

---

## Hook-based policy enforcement

`beforeRead` sees `{ url }`. Call `parseUrl` if you need fields, return
`{ ctx: { url } }` to rewrite. For more invasive transforms, wrap the executing
client.

```ts
import { buildUrl, parseUrl } from "@bandeira-tech/b3nd-core/url";

const rig = new Rig({
  routes: {/* … */},
  hooks: {
    beforeRead: (ctx) => {
      // Force every ls to be uri-only (no payload leaks to the bus).
      const parsed = parseUrl(ctx.url);
      if (parsed.fn !== "ls" || parsed.params.format === "uris") return;
      return {
        ctx: {
          url: buildUrl({
            ...parsed,
            params: { ...parsed.params, format: "uris" },
          }),
        },
      };
    },
  },
});
```

The rig dispatches the rewritten url unchanged to the connection; the executing
client parses again and honors the new params.

# Read-url cookbook

Real-world flows expressed as `pin.read([…])` batches. The patterns here use
Instagram as an example app, but the shapes apply to any content-addressed
system.

> **Shape recap.** `pin.read(urls)` returns flat `Output[]` — `[uri, payload]`
> tuples. "Not found" surfaces as absence (no Output). Synthetic answers (count
> results, observe envelopes, cursors) live under the reserved `b3nd://`
> namespace; each store/canon picks its own conventions there.
>
> The url grammar is `<uri>[?fn=…&param=value…]`. Trailing slash means `fn=ls`
> by default. Write urls inline — there are no builders to import.

---

## Profile screen first paint

User taps `@alice`. The screen needs the profile blob, the post-count badge, and
the first 12 thumbnail uris (the grid resolves them lazily). Three intents, one
round-trip:

```ts
const [profile, total, ...grid] = await pin.read([
  "instagram://users/alice",
  "instagram://users/alice/posts/?fn=count",
  "instagram://users/alice/posts/?format=uris&limit=12&sortBy=timestamp&sortOrder=desc",
]);

profile?.[1]; // { name, avatar, … }
total?.[1]; // 4127  — addressed at "b3nd://count/instagram://users/alice/posts/"
grid.map((r) => r[0]); // ["instagram://users/alice/posts/p1", …]
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
// `fn=count` produces one Output; `fn=ls` expands inline to N items —
// destructure: total = the count Output, page = the ls items.
const [total, ...page] = await pin.read([
  "instagram://posts/p123/comments/?fn=count",
  "instagram://posts/p123/comments/?limit=20&page=1&sortBy=timestamp&sortOrder=desc",
]);

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

// Page 1.
const page1 = await pin.read([
  buildUrl({
    uri: "instagram://hashtags/coffee/",
    fn: "x-feed.rank",
    params: { limit: 30 },
    ext: { "x-feed.algo": "engagement" },
  }),
]);

// The backend returns its data Outputs plus a synthetic cursor Output
// addressed under its own b3nd:// namespace. Find it by uri prefix.
const cursorOut = page1.find(([uri]) =>
  uri.startsWith("b3nd://x-feed/cursor/")
);
const cursor = cursorOut?.[1] as string | undefined;

// Page 2.
const page2 = await pin.read([
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

Observe yields `Output<string[]>` packages — `[meta, uris]` — INV-style. Iterate
the inner uris and read each:

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

# Group rig read dispatch by connection

**Date:** 2026-07-14
**Status:** Approved
**Type:** Breaking change (`refactor!`)

## Problem

`createRouteDispatch.read` in `src/rig/rig.ts` shreds a read batch into N
single-url reads — one `conn.client.read([url])` call per url:

```ts
async read<T = unknown>(urls: string[]): Promise<Output<T>[]> {
  const out: Output<T>[] = new Array(urls.length);
  await Promise.all(urls.map(async (url, i) => {
    const conn = read.find((s) => s.accepts(url));
    if (!conn) throw new Error(`No read route accepts ${url}`);
    const [r] = await conn.client.read<T>([url]);
    out[i] = r;
  }));
  return out;
}
```

A rig read of `["a", "b"]` where both route to the same connection issues
**two** reads of one url each. Batch-aware downstream clients never see the
batch. `observe` directly below it already does the right thing: it groups
urls by accepting connection and issues one call per connection.

## Why it's breaking

Downstream clients and b3nd-save backends can interpret a batch differently
than N singles — a multi-key store lookup, a listing grammar, transport
round-trip batching. Anything relying on seeing exactly one locator per
`read` call changes behavior. The `RecordingClient` records `urls` per call,
so any test asserting call-shape flips.

## Change

One function — `createRouteDispatch.read` (`src/rig/rig.ts`). Mirror the
group-by-connection pattern `observe` already uses:

1. Walk `urls` in order; for each, `read.find(s => s.accepts(url))`. A miss
   **throws** `No read route accepts <url>`, failing the whole batch —
   unchanged contract, treated as a programmer/config error.
2. Group urls by their accepting connection, remembering each url's original
   index (`Map<Connection, { url, i }[]>`).
3. Issue **one** `conn.client.read(groupUrls)` per connection, all in
   parallel via `Promise.all` — same concurrency as today.
4. Scatter each connection's results — returned in that group's input order
   per the `ProtocolRead` 1:1 contract — back into the output array by
   original index.

Result array stays 1:1 with input, same order, same routing
(first-accepting-connection-wins). Only difference: a connection serving K
urls in a batch gets one K-url call instead of K one-url calls.

## Non-goals

- No change to `Rig.read()`'s hook/event loop — it already hands the full
  batch to dispatch.
- No change to `receive` or `observe` dispatch.
- No hunt through b3nd-move / b3nd-save. Scope is this repo's rig dispatch.

## Tests (TDD, `RecordingClient` + `connection`)

- Batch of 2 urls → same connection → **one** recorded read call with
  `urls: ["a", "b"]`. Regression guard; fails on current code.
- Two urls routing to two different connections → each connection gets one
  call with its own url; results land in correct slots.
- Interleaved order (`["a", "b", "a2"]` where a, a2 → connA, b → connB) →
  output order matches input order exactly.
- Unrouted url in a batch → whole `read` throws `No read route accepts …`.

## Versioning

After green: bump `deno.json` 0.25.0 → 0.26.0, commit as
`refactor!(rig): batch read dispatch per connection instead of per-url`.
Matches how prior breaking changes (observe batching, PIN split) shipped
pre-1.0.

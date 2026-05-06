/**
 * URL grammar tests — parse/build round-trip, defaults, helpers.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  buildUrl,
  count,
  list,
  listUris,
  parseUrl,
  routingKey,
  x,
} from "./url.ts";

// ── parseUrl ────────────────────────────────────────────────────────

Deno.test("parseUrl - bare uri without slash defaults to fn=read", () => {
  const p = parseUrl("mutable://open/users/alice");
  assertEquals(p.uri, "mutable://open/users/alice");
  assertEquals(p.fn, "read");
  assertEquals(p.params, {});
  assertEquals(p.ext, {});
});

Deno.test("parseUrl - trailing slash defaults to fn=ls", () => {
  const p = parseUrl("mutable://open/users/");
  assertEquals(p.uri, "mutable://open/users/");
  assertEquals(p.fn, "ls");
});

Deno.test("parseUrl - explicit fn overrides trailing-slash default", () => {
  const p = parseUrl("mutable://open/users/?fn=count");
  assertEquals(p.uri, "mutable://open/users/");
  assertEquals(p.fn, "count");
});

Deno.test("parseUrl - explicit fn=read on trailing-slash uri", () => {
  const p = parseUrl("mutable://open/users/?fn=read");
  assertEquals(p.fn, "read");
  assertEquals(p.uri, "mutable://open/users/");
});

Deno.test("parseUrl - standard params coerced", () => {
  const p = parseUrl("m://x/?limit=20&page=3&format=uris&sortBy=timestamp");
  assertEquals(p.params.limit, 20);
  assertEquals(p.params.page, 3);
  assertEquals(p.params.format, "uris");
  assertEquals(p.params.sortBy, "timestamp");
});

Deno.test("parseUrl - x-* params land in ext", () => {
  const p = parseUrl(
    "m://x/?fn=ls&x-feed.rank=engagement&x-feed.cursor=abc123",
  );
  assertEquals(p.ext, {
    "x-feed.rank": "engagement",
    "x-feed.cursor": "abc123",
  });
  assertEquals(p.params, {});
});

Deno.test("parseUrl - invalid limit throws", () => {
  assertThrows(() => parseUrl("m://x/?limit=abc"), Error, "Invalid limit");
});

Deno.test("parseUrl - unknown standard param throws", () => {
  assertThrows(
    () => parseUrl("m://x/?wat=1"),
    Error,
    "Unknown read param: wat",
  );
});

Deno.test("parseUrl - x-* fn name passes through", () => {
  const p = parseUrl("m://x?fn=x-pg.scan");
  assertEquals(p.fn, "x-pg.scan");
});

// ── buildUrl ────────────────────────────────────────────────────────

Deno.test("buildUrl - bare uri returns uri", () => {
  assertEquals(buildUrl({ uri: "m://x" }), "m://x");
});

Deno.test("buildUrl - fn matching trailing-slash default omits fn=", () => {
  assertEquals(buildUrl({ uri: "m://x/", fn: "ls" }), "m://x/");
  assertEquals(buildUrl({ uri: "m://x", fn: "read" }), "m://x");
});

Deno.test("buildUrl - non-default fn included", () => {
  assertEquals(buildUrl({ uri: "m://x/", fn: "count" }), "m://x/?fn=count");
  assertEquals(buildUrl({ uri: "m://x", fn: "ls" }), "m://x?fn=ls");
});

Deno.test("buildUrl - omits undefined params", () => {
  assertEquals(
    buildUrl({ uri: "m://x/", fn: "ls", params: { limit: 10 } }),
    "m://x/?limit=10",
  );
});

Deno.test("buildUrl - non-x ext key throws", () => {
  assertThrows(
    () => buildUrl({ uri: "m://x", ext: { foo: "1" } }),
    Error,
    "ext keys must start with 'x-'",
  );
});

// ── round-trip ──────────────────────────────────────────────────────

Deno.test("round-trip - bare uri", () => {
  const url = "mutable://open/users/alice";
  assertEquals(buildUrl(parseUrl(url)), url);
});

Deno.test("round-trip - count over prefix", () => {
  const url = "mutable://open/users/?fn=count";
  assertEquals(buildUrl(parseUrl(url)), url);
});

Deno.test("round-trip - listUris with limit", () => {
  const url = "mutable://open/users/?format=uris&limit=12";
  assertEquals(buildUrl(parseUrl(url)), url);
});

Deno.test("round-trip - x-* fn with ext", () => {
  const url = "m://hashtags/coffee/?fn=x-feed.rank&x-feed.cursor=eyJ";
  assertEquals(buildUrl(parseUrl(url)), url);
});

// ── routingKey ──────────────────────────────────────────────────────

Deno.test("routingKey - strips query", () => {
  assertEquals(
    routingKey("mutable://open/users/?fn=count&limit=5"),
    "mutable://open/users/",
  );
});

Deno.test("routingKey - preserves trailing slash", () => {
  assertEquals(routingKey("m://x/"), "m://x/");
  assertEquals(routingKey("m://x"), "m://x");
});

// ── helpers ─────────────────────────────────────────────────────────

Deno.test("count - adds trailing slash and fn=count", () => {
  assertEquals(count("m://x"), "m://x/?fn=count");
  assertEquals(count("m://x/"), "m://x/?fn=count");
});

Deno.test("count - passes through params and ext", () => {
  assertEquals(
    count("m://x", { pattern: "a*", ext: { "x-pg.shard": "2" } }),
    "m://x/?fn=count&pattern=a*&x-pg.shard=2",
  );
});

Deno.test("list - adds trailing slash, fn=ls (omitted as default), format=full", () => {
  assertEquals(list("m://x"), "m://x/?format=full");
  assertEquals(list("m://x/"), "m://x/?format=full");
});

Deno.test("list - threads limit/page/sort", () => {
  assertEquals(
    list("m://x", { limit: 12, page: 2, sortBy: "timestamp" }),
    "m://x/?format=full&limit=12&page=2&sortBy=timestamp",
  );
});

Deno.test("listUris - format=uris", () => {
  assertEquals(listUris("m://x"), "m://x/?format=uris");
  assertEquals(
    listUris("m://x", { limit: 30 }),
    "m://x/?format=uris&limit=30",
  );
});

Deno.test("x - rejects non-x- fn names", () => {
  assertThrows(() => x("m://x", "scan"), Error, "x() requires fn name");
});

Deno.test("x - emits provider fn with ext", () => {
  assertEquals(
    x("m://x/", "x-pg.scan", { limit: 50, ext: { "x-pg.cursor": "z" } }),
    "m://x/?fn=x-pg.scan&limit=50&x-pg.cursor=z",
  );
});

// ── helper composition ─────────────────────────────────────────────

Deno.test("helpers compose into a read([...]) batch", () => {
  const urls = [
    "mutable://users/alice",
    count("mutable://users/alice/posts/"),
    listUris("mutable://users/alice/posts/", {
      limit: 12,
      sortBy: "timestamp",
      sortOrder: "desc",
    }),
  ];
  assertEquals(urls, [
    "mutable://users/alice",
    "mutable://users/alice/posts/?fn=count",
    "mutable://users/alice/posts/?format=uris&limit=12&sortBy=timestamp&sortOrder=desc",
  ]);
});

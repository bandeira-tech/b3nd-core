import { assert, assertEquals, assertFalse } from "@std/assert";
import { and, any, not, or, patterns, prefix, schemas } from "./acceptance.ts";
import { connection } from "./connection.ts";
import { Rig } from "./rig.ts";
import type { Output, ProtocolInterfaceNode } from "../types/types.ts";

// Minimal recording client — captures receive batches for assertion.
function recordingClient(): ProtocolInterfaceNode & { received: Output[][] } {
  const received: Output[][] = [];
  return {
    received,
    receive: (msgs) => {
      received.push(msgs);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
    read: <T = unknown>(urls: string[]) =>
      Promise.resolve(
        urls.map((u) => [u, undefined as unknown as T] as Output<T>),
      ),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" }),
  };
}

// ── patterns() ──

Deno.test("patterns - matches exact and wildcard", () => {
  const a = patterns("mutable://app/*", "hash://sha256/:digest");
  assert(a.accepts("mutable://app/users/alice"));
  assert(a.accepts("hash://sha256/abc123"));
  assertFalse(a.accepts("notify://email/x"));
});

Deno.test("patterns - describe() returns frozen string[]", () => {
  const a = patterns("mutable://*", "hash://*");
  const described = a.describe?.();
  assertEquals(described, ["mutable://*", "hash://*"]);
});

// ── any ──

Deno.test("any - accepts everything", () => {
  assert(any.accepts("mutable://x"));
  assert(any.accepts("anything-at-all"));
  assertEquals(any.describe?.(), ["*"]);
});

// ── prefix() ──

Deno.test("prefix - accepts by string prefix", () => {
  const a = prefix("mutable://accounts/");
  assert(a.accepts("mutable://accounts/alice"));
  assertFalse(a.accepts("mutable://other/x"));
  assertEquals(a.describe?.(), { prefix: "mutable://accounts/" });
});

// ── schemas() ──

Deno.test("schemas - accepts by URI scheme", () => {
  const a = schemas("mutable", "notify");
  assert(a.accepts("mutable://x/y"));
  assert(a.accepts("notify://email/u"));
  assertFalse(a.accepts("hash://sha256/abc"));
  assertFalse(a.accepts("no-scheme"));
});

// ── composition ──

Deno.test("not - inverts acceptance, no describe", () => {
  const a = not(prefix("test://"));
  assert(a.accepts("mutable://x"));
  assertFalse(a.accepts("test://x"));
  assertEquals(a.describe, undefined);
});

Deno.test("and - all must accept", () => {
  const a = and(schemas("mutable"), not(prefix("mutable://test/")));
  assert(a.accepts("mutable://app/x"));
  assertFalse(a.accepts("mutable://test/x"));
  assertFalse(a.accepts("hash://abc"));
});

Deno.test("or - any may accept", () => {
  const a = or(schemas("hash"), prefix("mutable://accounts/"));
  assert(a.accepts("hash://abc"));
  assert(a.accepts("mutable://accounts/alice"));
  assertFalse(a.accepts("mutable://other/x"));
});

// ── connection() + Acceptance ──

Deno.test("connection - accepts Acceptance object", () => {
  const client = recordingClient();
  const conn = connection(client, schemas("notify"));
  assert(conn.accepts("notify://email/u"));
  assertFalse(conn.accepts("mutable://x"));
});

Deno.test("connection - string[] still works (back-compat)", () => {
  const client = recordingClient();
  const conn = connection(client, ["mutable://*"]);
  assert(conn.accepts("mutable://x/y"));
  assertEquals(conn.patterns, ["mutable://*"]);
});

Deno.test("connection - patterns slot undefined for non-string-array describes", () => {
  const client = recordingClient();
  const conn = connection(client, prefix("mutable://"));
  assertEquals(conn.patterns, undefined);
});

// ── Route tuple in RigRoutes ──

Deno.test("Rig - accepts Route tuple in routes", async () => {
  const client = recordingClient();
  const rig = new Rig({
    routes: {
      receive: [[patterns("mutable://*"), client, "primary"]],
      read: [[any, client]],
      observe: [[patterns("mutable://*"), client]],
    },
  });

  await rig.receiveOrThrow([["mutable://app/x", { value: 1 }]]);
  assertEquals(client.received.length, 1);
  assertEquals(client.received[0][0][0], "mutable://app/x");
});

Deno.test("Rig - Route tuple with string[] shorthand", async () => {
  const client = recordingClient();
  const rig = new Rig({
    routes: {
      receive: [[["mutable://*"], client]],
    },
  });
  await rig.receiveOrThrow([["mutable://app/x", { value: 1 }]]);
  assertEquals(client.received[0][0][0], "mutable://app/x");
});

Deno.test("Rig - mixes Connection and Route tuples", async () => {
  const a = recordingClient();
  const b = recordingClient();
  const conn = connection(a, ["mutable://*"], { id: "a" });
  const rig = new Rig({
    routes: {
      receive: [conn, [schemas("notify"), b, "b"]],
    },
  });

  await rig.receiveOrThrow([
    ["mutable://x/y", 1],
    ["notify://email/u", 2],
  ]);

  assertEquals(a.received.length, 1);
  assertEquals(a.received[0][0][0], "mutable://x/y");
  assertEquals(b.received.length, 1);
  assertEquals(b.received[0][0][0], "notify://email/u");
});

Deno.test("Rig - custom predicate Acceptance routes correctly", async () => {
  const client = recordingClient();
  const onlyEven: import("./acceptance.ts").Acceptance = {
    accepts: (uri) =>
      /\/(\d+)$/.test(uri) && Number(uri.split("/").pop()) % 2 === 0,
  };
  const rig = new Rig({
    routes: {
      receive: [[onlyEven, client]],
    },
  });

  await rig.receive([["mutable://n/2", 1]]);
  await rig.receive([["mutable://n/3", 1]]);

  // Only the even URI lands.
  assertEquals(client.received.length, 1);
  assertEquals(client.received[0][0][0], "mutable://n/2");
});

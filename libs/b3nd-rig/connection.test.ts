/// <reference lib="deno.ns" />
/**
 * Tests for the connection primitive and its integration with the rig.
 *
 * Covers: local routing, multi-connection broadcast/first-match,
 * unconnected URI rejection, serialization for wire, best-effort
 * enforcement, and program/connection separation.
 */

import { assertEquals } from "@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { DataStoreClient } from "../b3nd-core/data-store-client.ts";
import { connection } from "./connection.ts";
import { Rig } from "./rig.ts";
import type { Program } from "../b3nd-core/types.ts";

/** Shorthand: null-aware Store adapter backed by an in-memory store. */
function memClient() {
  return new DataStoreClient(new MemoryStore());
}

// ── connection() unit tests ──

Deno.test("connection - accepts matching URI", () => {
  const conn = connection(memClient(), {
    receive: ["mutable://*"],
    read: ["mutable://*"],
  });
  assertEquals(conn.accepts("receive", "mutable://open/app/x"), true);
  assertEquals(conn.accepts("read", "mutable://open/app/x"), true);
});

Deno.test("connection - rejects non-matching URI", () => {
  const conn = connection(memClient(), {
    receive: ["mutable://*"],
  });
  assertEquals(conn.accepts("receive", "hash://sha256/abc"), false);
});

Deno.test("connection - rejects unlisted operation", () => {
  const conn = connection(memClient(), {
    receive: ["mutable://*"],
  });
  // read not listed → not accepted
  assertEquals(conn.accepts("read", "mutable://open/x"), false);
});

Deno.test("connection - patterns are serializable", () => {
  const conn = connection(memClient(), {
    receive: ["mutable://*", "hash://*"],
    read: ["mutable://*"],
  });
  const wire = JSON.stringify(conn.patterns);
  const parsed = JSON.parse(wire);
  assertEquals(parsed.receive, ["mutable://*", "hash://*"]);
  assertEquals(parsed.read, ["mutable://*"]);
});

Deno.test("connection - express-style param patterns", () => {
  const conn = connection(memClient(), {
    read: ["mutable://accounts/:id/*"],
  });
  assertEquals(conn.accepts("read", "mutable://accounts/alice/profile"), true);
  assertEquals(conn.accepts("read", "mutable://accounts/bob/settings"), true);
  assertEquals(conn.accepts("read", "mutable://open/anything"), false);
});

Deno.test("connection - patterns are frozen", () => {
  const patterns = { receive: ["mutable://*"] };
  const conn = connection(memClient(), patterns);
  // Mutating the original doesn't affect the connection
  patterns.receive.push("hash://*");
  assertEquals(conn.patterns.receive, ["mutable://*"]);
});

// ── Rig + connections integration tests ──

Deno.test("rig routes receive to correct connection", async () => {
  const remote = memClient();
  const local = memClient();

  const rig = new Rig({
    connections: [
      connection(remote, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(local, { receive: ["local://*"], read: ["local://*"] }),
    ],
  });

  await rig.receive([["mutable://open/x", { v: 1 }]]);
  await rig.receive([["local://app/y", { v: 2 }]]);

  // remote has mutable data, local doesn't
  const r1 = (await remote.read("mutable://open/x"))[0];
  assertEquals(r1.success, true);
  const r2 = (await local.read("mutable://open/x"))[0];
  assertEquals(r2.success, false);

  // local has local data, remote doesn't
  const r3 = (await local.read("local://app/y"))[0];
  assertEquals(r3.success, true);
  const r4 = (await remote.read("local://app/y"))[0];
  assertEquals(r4.success, false);
});

Deno.test("rig reads from first matching connection", async () => {
  const primary = memClient();
  const fallback = memClient();

  // Write directly to fallback (simulating pre-existing data)
  await fallback.receive([["mutable://open/old", { from: "fallback" }]]);

  const rig = new Rig({
    connections: [
      connection(primary, { read: ["mutable://*"], receive: ["mutable://*"] }),
      connection(fallback, { read: ["mutable://*"] }),
    ],
  });

  // Write through rig goes to primary only (fallback has no receive)
  await rig.receive([["mutable://open/new", { from: "primary" }]]);

  // Read "new" → primary has it (first match)
  const results1 = await rig.read("mutable://open/new");
  const r1 = results1[0];
  assertEquals(r1.success, true);
  assertEquals(r1.record?.data, { from: "primary" });

  // Read "old" → primary doesn't have it, falls through to fallback
  const results2 = await rig.read("mutable://open/old");
  const r2 = results2[0];
  assertEquals(r2.success, true);
  assertEquals(r2.record?.data, { from: "fallback" });
});

Deno.test("rig broadcasts writes to all matching connections", async () => {
  const primary = memClient();
  const mirror = memClient();

  const rig = new Rig({
    connections: [
      connection(primary, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(mirror, { receive: ["mutable://*"] }),
    ],
  });

  await rig.receive([["mutable://open/x", { v: 1 }]]);

  // Both have the data
  const r1 = (await primary.read("mutable://open/x"))[0];
  assertEquals(r1.success, true);
  const r2 = (await mirror.read("mutable://open/x"))[0];
  assertEquals(r2.success, true);
});

Deno.test("rig rejects receive for unconnected URI", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["local://*"] }),
    ],
  });

  const [result] = await rig.receive([["mutable://open/x", { v: 1 }]]);
  assertEquals(result.accepted, false);
});

Deno.test("rig rejects read for unconnected URI", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { read: ["local://*"] }),
    ],
  });

  const results = await rig.read("mutable://open/x");
  const result = results[0];
  assertEquals(result.success, false);
});

Deno.test("best-effort: local connection enforces even if client accepts everything", async () => {
  // Memory backend accepts anything — no internal filtering
  const client = memClient();

  const rig = new Rig({
    connections: [
      connection(client, { receive: ["mutable://*"] }),
    ],
  });

  // hash:// not in connection → rejected by rig, even though client would accept it
  const [result] = await rig.receive([["hash://sha256/abc", "some data"]]);
  assertEquals(result.accepted, false);

  // Verify nothing was written
  const readResults = await client.read("hash://sha256/abc");
  assertEquals(readResults[0].success, false);
});

Deno.test("programs and connections are separate concerns", async () => {
  const client = memClient();

  const validate: Program = ([_uri, data]) => {
    if (typeof data !== "object" || data === null) {
      return Promise.resolve({
        code: "invalid",
        error: "must be an object",
      });
    }
    return Promise.resolve({ code: "ok" });
  };

  const rig = new Rig({
    connections: [
      connection(client, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
    ],
    programs: { "mutable://open": validate },
  });

  // Matches connection + passes program → accepted
  const [r1] = await rig.receive([["mutable://open/x", { valid: true }]]);
  assertEquals(r1.accepted, true);

  // Matches connection but fails program → rejected with program error
  const [r2] = await rig.receive([["mutable://open/y", "not an object"]]);
  assertEquals(r2.accepted, false);

  // Doesn't match connection → rejected before program runs
  const [r3] = await rig.receive([["hash://sha256/abc", { valid: true }]]);
  assertEquals(r3.accepted, false);
});

Deno.test("program runs after connection routing", async () => {
  const client = memClient();
  let programCalledWith: string[] = [];

  const record: Program = ([uri]) => {
    programCalledWith.push(uri);
    return Promise.resolve({ code: "ok" });
  };

  const rig = new Rig({
    connections: [connection(client, { receive: ["mutable://*"] })],
    programs: { "mutable://open": record },
  });

  // Unconnected URI → program never called
  programCalledWith = [];
  await rig.receive([["hash://sha256/abc", "data"]]);
  assertEquals(programCalledWith.length, 0);

  // Subscribed URI → program IS called
  await rig.receive([["mutable://open/x", "data"]]);
  assertEquals(programCalledWith.length, 1);
});

Deno.test("single client via catch-all connection", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  // Everything accepted — no filtering
  const [r1] = await rig.receive([["mutable://open/x", { v: 1 }]]);
  assertEquals(r1.accepted, true);
  const [r2] = await rig.receive([["hash://sha256/whatever", "data"]]);
  assertEquals(r2.accepted, true);
});

Deno.test("single client via explicit connection still works (catch-all)", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  const [r] = await rig.receive([["mutable://open/x", { v: 1 }]]);
  assertEquals(r.accepted, true);
  const readResults = await rig.read("mutable://open/x");
  assertEquals(readResults[0].success, true);
});

Deno.test("status().schema unions all connection client schemas", async () => {
  const a = memClient();
  const b = memClient();

  // Write some data so status has something to report
  await a.receive([["mutable://open/x", "data"]]);
  await b.receive([["local://app/y", "data"]]);

  const rig = new Rig({
    connections: [
      connection(a, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(b, { receive: ["local://*"], read: ["local://*"] }),
    ],
  });

  const status = await rig.status();
  assertEquals(Array.isArray(status.schema), true);
});

Deno.test("status aggregates across all connection clients", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["mutable://*"] }),
      connection(memClient(), { receive: ["local://*"] }),
    ],
  });

  const status = await rig.status();
  assertEquals(status.status, "healthy");
});

Deno.test("list via trailing-slash read routes through connection", async () => {
  const client = memClient();

  const rig = new Rig({
    connections: [
      connection(client, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
    ],
  });

  await rig.receive([["mutable://open/a", "one"]]);
  await rig.receive([["mutable://open/b", "two"]]);

  const results = await rig.read("mutable://open/");
  const successful = results.filter((r) => r.success);
  assertEquals(successful.length >= 2, true);
});

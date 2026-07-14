/**
 * Tests for the Rig's status() derivation of ResourceCapabilities.
 *
 * Contract:
 *  - `status().resources` is derived from the rig's own route table.
 *    For each verb V in {read, observe, receive}, the result includes
 *    every `pattern` declared by any `connection(node, patterns)`
 *    wired into `routes[V]`. Downstream node-reported `resources` are
 *    ignored — the rig is the authority.
 *  - Patterns are deduped within each verb.
 *  - A verb with no wired connections (or no patterns) is omitted.
 *  - If all three verbs are empty, the `resources` field is omitted
 *    entirely (not `{}`).
 *  - Wildcard patterns (`*`, `**`) are reported verbatim — not expanded.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection } from "./connection.ts";
import { RecordingClient } from "../testing/recording-client.ts";
import type { Output, ResourceCapabilities } from "../types/types.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

/** A trivial healthy client. Downstream-reported resources are ignored
 *  by the new aggregator, but we let callers override status anyway so
 *  the tests can prove that downstream reports do NOT leak through. */
function makeClient(resources?: ResourceCapabilities) {
  return new RecordingClient({
    status: () => ({
      status: "healthy" as const,
      ...(resources !== undefined ? { resources } : {}),
    }),
  });
}

// ── status().resources derivation ────────────────────────────────────────────

Deno.test(
  "Rig status() - derives resources per verb from route patterns",
  async () => {
    const node = makeClient();
    const conn = connection(node, ["immutable://open/"]);

    const rig = new Rig({
      routes: {
        receive: [conn],
        read: [conn],
        observe: [conn],
      },
    });

    const s = await rig.status();
    assertEquals(s.resources, {
      read: ["immutable://open/"],
      observe: ["immutable://open/"],
      receive: ["immutable://open/"],
    });
  },
);

Deno.test(
  "Rig status() - asymmetric wiring: read-only connection only contributes to read",
  async () => {
    const writable = makeClient();
    const readOnly = makeClient();

    const writeConn = connection(writable, ["mutable://app/"]);
    const readConn = connection(readOnly, ["cache://hot/"]);

    const rig = new Rig({
      routes: {
        receive: [writeConn],
        read: [writeConn, readConn],
        observe: [writeConn],
      },
    });

    const s = await rig.status();
    assertEquals((s.resources as ResourceCapabilities).read?.sort(), [
      "cache://hot/",
      "mutable://app/",
    ]);
    assertEquals(s.resources?.observe, ["mutable://app/"]);
    assertEquals(s.resources?.receive, ["mutable://app/"]);
  },
);

Deno.test(
  "Rig status() - aggregates multiple patterns per connection, per verb",
  async () => {
    // One node serving multiple URI families on all three verbs.
    const node = makeClient();
    const conn = connection(node, ["store://items/", "store://users/"]);
    // Another node only on read, contributing a third family.
    const archive = makeClient();
    const archiveRead = connection(archive, ["store://archive/"]);

    const rig = new Rig({
      routes: {
        receive: [conn],
        read: [conn, archiveRead],
        observe: [conn],
      },
    });

    const s = await rig.status();
    assertEquals((s.resources as ResourceCapabilities).read?.sort(), [
      "store://archive/",
      "store://items/",
      "store://users/",
    ]);
    assertEquals((s.resources as ResourceCapabilities).observe?.sort(), [
      "store://items/",
      "store://users/",
    ]);
    assertEquals((s.resources as ResourceCapabilities).receive?.sort(), [
      "store://items/",
      "store://users/",
    ]);
  },
);

Deno.test(
  "Rig status() - deduplicates patterns within a verb across connections",
  async () => {
    const a = makeClient();
    const b = makeClient();
    const shared = "store://shared/";

    const connA = connection(a, [shared]);
    const connB = connection(b, [shared]);

    const rig = new Rig({
      routes: {
        receive: [connA],
        read: [connA, connB],
        observe: [connA],
      },
    });

    const s = await rig.status();
    assertEquals((s.resources as ResourceCapabilities).read, [shared]);
  },
);

Deno.test(
  "Rig status() - ignores downstream-reported resources entirely",
  async () => {
    // The downstream node claims to serve URIs the rig never wired up.
    // The rig must NOT propagate those — its routes are the authority.
    const lying = makeClient({
      read: ["bogus://lying/"],
      observe: ["bogus://lying/"],
      receive: ["bogus://lying/"],
    });
    const conn = connection(lying, ["truth://only/"]);

    const rig = new Rig({
      routes: {
        receive: [conn],
        read: [conn],
        observe: [conn],
      },
    });

    const s = await rig.status();
    assertEquals(s.resources, {
      read: ["truth://only/"],
      observe: ["truth://only/"],
      receive: ["truth://only/"],
    });
  },
);

Deno.test(
  "Rig status() - omits a verb whose route has no connections",
  async () => {
    // observe route is empty — receive + read are wired.
    const node = makeClient();
    const conn = connection(node, ["store://items/"]);

    const rig = new Rig({
      routes: {
        receive: [conn],
        read: [conn],
      },
    });

    const s = await rig.status();
    assertEquals(s.resources?.read, ["store://items/"]);
    assertEquals(s.resources?.receive, ["store://items/"]);
    // observe must be omitted entirely — not an empty array.
    assertEquals(s.resources?.observe, undefined);
  },
);

Deno.test(
  "Rig status() - reports wildcard patterns verbatim",
  async () => {
    const node = makeClient();
    const conn = connection(node, ["**", "mutable://*/data/**"]);

    const rig = new Rig({
      routes: {
        receive: [conn],
        read: [conn],
        observe: [conn],
      },
    });

    const s = await rig.status();
    assertEquals((s.resources as ResourceCapabilities).read?.sort(), [
      "**",
      "mutable://*/data/**",
    ]);
  },
);

// ── read() dispatch: batches stay batched ─────────────────────────────────────
//
// Contract: the rig groups a read batch by accepting connection and issues
// ONE `read` call per connection with all the urls that route to it — never
// one call per url. Results stay 1:1 with input order. Routing is unchanged:
// each url goes to the first connection whose patterns accept it.

Deno.test(
  "Rig read() - urls sharing a connection dispatch as a single batched call",
  async () => {
    const node = new RecordingClient({
      read: (urls) => urls.map((u): Output => [u, { got: u }]),
    });
    const conn = connection(node, ["store://items/**"]);
    const rig = new Rig({ routes: { read: [conn] } });

    const out = await rig.read(["store://items/a", "store://items/b"]);

    // One read call carrying BOTH urls — not two single-url calls.
    assertEquals(node.callsOf("read").length, 1);
    assertEquals(node.callsOf("read")[0].urls, [
      "store://items/a",
      "store://items/b",
    ]);
    // Results 1:1 with input.
    assertEquals(out, [
      ["store://items/a", { got: "store://items/a" }],
      ["store://items/b", { got: "store://items/b" }],
    ]);
  },
);

Deno.test(
  "Rig read() - urls on different connections each get one call, correct slots",
  async () => {
    const nodeA = new RecordingClient({
      read: (urls) => urls.map((u): Output => [u, "A"]),
    });
    const nodeB = new RecordingClient({
      read: (urls) => urls.map((u): Output => [u, "B"]),
    });
    const connA = connection(nodeA, ["store://a/**"]);
    const connB = connection(nodeB, ["store://b/**"]);
    const rig = new Rig({ routes: { read: [connA, connB] } });

    const out = await rig.read(["store://a/1", "store://b/1"]);

    assertEquals(nodeA.callsOf("read").length, 1);
    assertEquals(nodeA.callsOf("read")[0].urls, ["store://a/1"]);
    assertEquals(nodeB.callsOf("read").length, 1);
    assertEquals(nodeB.callsOf("read")[0].urls, ["store://b/1"]);
    assertEquals(out, [
      ["store://a/1", "A"],
      ["store://b/1", "B"],
    ]);
  },
);

Deno.test(
  "Rig read() - interleaved batch preserves input order across connections",
  async () => {
    const nodeA = new RecordingClient({
      read: (urls) => urls.map((u): Output => [u, "A"]),
    });
    const nodeB = new RecordingClient({
      read: (urls) => urls.map((u): Output => [u, "B"]),
    });
    const connA = connection(nodeA, ["store://a/**"]);
    const connB = connection(nodeB, ["store://b/**"]);
    const rig = new Rig({ routes: { read: [connA, connB] } });

    // a, b, a2 interleaved: connA sees ["a/1","a/2"] in one call, order kept.
    const out = await rig.read([
      "store://a/1",
      "store://b/1",
      "store://a/2",
    ]);

    assertEquals(nodeA.callsOf("read")[0].urls, ["store://a/1", "store://a/2"]);
    assertEquals(nodeB.callsOf("read")[0].urls, ["store://b/1"]);
    assertEquals(out, [
      ["store://a/1", "A"],
      ["store://b/1", "B"],
      ["store://a/2", "A"],
    ]);
  },
);

Deno.test(
  "Rig read() - an unrouted url throws for the whole batch",
  async () => {
    const node = new RecordingClient();
    const conn = connection(node, ["store://items/**"]);
    const rig = new Rig({ routes: { read: [conn] } });

    await assertRejects(
      () => rig.read(["store://items/a", "elsewhere://x"]),
      Error,
      "No read route accepts elsewhere://x",
    );
  },
);

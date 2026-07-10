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

import { assertEquals } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection } from "./connection.ts";
import { RecordingClient } from "../testing/recording-client.ts";
import type { ResourceCapabilities } from "../types/types.ts";

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

// ── observe finalization (observe-finalize gap) ──────────────────────────────

Deno.test(
  "Rig observe - breaking the loop without aborting finalizes promptly",
  async () => {
    // A source that yields one batch, then blocks until its signal aborts.
    const blockingSource = (_urls: string[], signal: AbortSignal) =>
      (async function* () {
        yield ["mutable://x/1"] as readonly string[];
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      })();

    const node = new RecordingClient({ observe: blockingSource });
    const conn = connection(node, ["mutable://x/**"]);
    const rig = new Rig({ routes: { observe: [conn] } });

    // Deliberately never aborted: the consumer leaves by `break`, and
    // finalization must still tear the source stream down.
    const ac = new AbortController();
    let events = 0;
    const drain = (async () => {
      for await (const _batch of rig.observe(["mutable://x/1"], ac.signal)) {
        events++;
        break;
      }
    })();

    let timer = 0;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), 1000);
    });
    const winner = await Promise.race([
      drain.then(() => "done" as const),
      timeout,
    ]);
    clearTimeout(timer);
    ac.abort(); // unblock the source if the loop actually hung
    await drain.catch(() => {});
    assertEquals(events, 1); // the source really fired before we broke
    assertEquals(winner, "done");
  },
);

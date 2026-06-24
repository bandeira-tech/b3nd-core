/**
 * Tests for the Rig's status() aggregation of ResourceCapabilities.
 *
 * Covers:
 *  1. Per-verb aggregation: a node's prefix only counts toward verb V if
 *     that node is wired into the rig's V route.
 *  2. Deduplication within each verb.
 *  3. A node that reports nothing under `resources` doesn't pollute the
 *     result (omitted entirely, not an empty array).
 *  4. If no node reports any `resources`, the rig's status omits the field.
 */

import { assertEquals } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection } from "./connection.ts";
import { RecordingClient } from "../testing/recording-client.ts";
import type { ResourceCapabilities } from "../types/types.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeClient(resources?: ResourceCapabilities) {
  return new RecordingClient({
    status: () => ({
      status: "healthy" as const,
      ...(resources !== undefined ? { resources } : {}),
    }),
  });
}

// ── status().resources aggregation ───────────────────────────────────────────

Deno.test(
  "Rig status() - aggregates resources per verb from downstream nodes",
  async () => {
    // Node A: wired into all three verbs, reports resources for all three.
    const nodeA = makeClient({
      read: ["store://items/", "store://users/"],
      observe: ["store://items/"],
      receive: ["store://items/"],
    });

    // Node B: wired into receive + read only (not observe), reports for
    // receive + read (its observe entry should not appear in the rig's
    // aggregated observe because it's not on the observe route).
    const nodeB = makeClient({
      read: ["store://archive/"],
      receive: ["store://archive/"],
      observe: ["store://archive/"], // wired into receive/read only — should be dropped
    });

    const connA = connection(nodeA, ["store://**"]);
    const connBReceiveRead = connection(nodeB, ["store://**"]);

    const rig = new Rig({
      routes: {
        receive: [connA, connBReceiveRead],
        read: [connA, connBReceiveRead],
        observe: [connA], // nodeB intentionally excluded from observe
      },
    });

    const s = await rig.status();

    // read: nodeA contributes store://items/ and store://users/;
    //       nodeB contributes store://archive/ — all three appear.
    assertEquals((s.resources as ResourceCapabilities).read?.sort(), [
      "store://archive/",
      "store://items/",
      "store://users/",
    ]);

    // observe: only nodeA is on the observe route, so only store://items/
    assertEquals((s.resources as ResourceCapabilities).observe, [
      "store://items/",
    ]);

    // receive: nodeA + nodeB both on receive route, each contributes one prefix
    assertEquals((s.resources as ResourceCapabilities).receive?.sort(), [
      "store://archive/",
      "store://items/",
    ]);
  },
);

Deno.test(
  "Rig status() - deduplicates prefixes within each verb",
  async () => {
    const prefix = "store://shared/";
    const nodeA = makeClient({ read: [prefix] });
    const nodeB = makeClient({ read: [prefix] });

    const connA = connection(nodeA, ["store://**"]);
    const connB = connection(nodeB, ["store://**"]);

    const rig = new Rig({
      routes: {
        receive: [connA],
        read: [connA, connB],
        observe: [connA],
      },
    });

    const s = await rig.status();
    // Both nodes report the same prefix — result must deduplicate.
    assertEquals((s.resources as ResourceCapabilities).read, [prefix]);
  },
);

Deno.test(
  "Rig status() - node with no resources field does not pollute result",
  async () => {
    // nodeA has resources; nodeB has none at all.
    const nodeA = makeClient({ read: ["store://items/"] });
    const nodeB = makeClient(/* no resources */);

    const connA = connection(nodeA, ["store://**"]);
    const connB = connection(nodeB, ["store://**"]);

    const rig = new Rig({
      routes: {
        receive: [connA],
        read: [connA, connB],
        observe: [connA],
      },
    });

    const s = await rig.status();
    // nodeB must not add an empty array or undefined entry.
    assertEquals((s.resources as ResourceCapabilities).read, ["store://items/"]);
    assertEquals(
      (s.resources as ResourceCapabilities).observe,
      undefined,
    );
    assertEquals(
      (s.resources as ResourceCapabilities).receive,
      undefined,
    );
  },
);

Deno.test(
  "Rig status() - omits resources field entirely when no node reports any",
  async () => {
    const nodeA = makeClient(); // no resources
    const nodeB = makeClient(); // no resources
    const connA = connection(nodeA, ["store://**"]);
    const connB = connection(nodeB, ["store://**"]);

    const rig = new Rig({
      routes: {
        receive: [connA],
        read: [connA, connB],
        observe: [connA],
      },
    });

    const s = await rig.status();
    // `resources` must be absent — not `{}`, not an object with empty arrays.
    assertEquals(s.resources, undefined);
  },
);

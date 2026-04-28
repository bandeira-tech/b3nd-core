/**
 * Node Test Suite
 *
 * Tests for the unified Node interface (receive pattern).
 * This suite tests that any implementation of Node & ReadInterface
 * behaves correctly as mechanical storage.
 *
 * Message primitive: [uri, payload]. For envelope-shaped payloads the
 * payload is `{ inputs: string[], outputs: Output[] }`.
 *
 * receive() takes Message[] — batch of independent messages.
 * Clients are mechanical: delete inputs, write outputs.
 * Conservation and program logic are rig-level concerns.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { ProtocolInterfaceNode } from "../b3nd-core/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let _seq = 0;

/** Build a Message wrapping outputs into an envelope. */
function msg(
  outputs: [string, unknown][],
  inputs: string[] = [],
): [string, { inputs: string[]; outputs: [string, unknown][] }] {
  return [`envelope://test/node-${++_seq}`, { inputs, outputs }];
}

/**
 * Test client factory for Node interface tests
 */
export interface NodeTestFactory {
  /** Factory for working node (happy path tests) */
  happy: () => ProtocolInterfaceNode | Promise<ProtocolInterfaceNode>;

  /** Factory for node that rejects validation */
  validationError?: () =>
    | ProtocolInterfaceNode
    | Promise<ProtocolInterfaceNode>;
}

/**
 * Run the node test suite against provided factory
 */
export function runNodeSuite(
  suiteName: string,
  factory: NodeTestFactory,
) {
  const noSanitize = { sanitizeOps: false, sanitizeResources: false };

  Deno.test({
    name: `${suiteName} [Node] - receive and read`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const results = await node.receive([
        msg([["store://users/alice/profile", {
          name: "Alice",
          email: "alice@example.com",
        }]]),
      ]);

      assertEquals(results[0].accepted, true);
      assertEquals(results[0].error, undefined);

      const readResults = await node.read("store://users/alice/profile");

      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive multiple messages in batch`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const results = await node.receive([
        msg([["store://users/alice/profile", { name: "Alice" }]]),
        msg([["store://users/bob/profile", { name: "Bob" }]]),
      ]);

      assertEquals(results.length, 2);
      assertEquals(results[0].accepted, true);
      assertEquals(results[1].accepted, true);

      // Verify both were stored
      const read1 = await node.read("store://users/alice/profile");
      const read2 = await node.read("store://users/bob/profile");

      assertEquals(read1.length, 1);
      assertEquals(read2.length, 1);
      assertEquals(read1[0].success, true);
      assertEquals(read2[0].success, true);
      assertEquals(read1[0].record?.data, { name: "Alice" });
      assertEquals(read2[0].record?.data, { name: "Bob" });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive overwrites existing data`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      // Write initial data
      await node.receive([
        msg([["store://users/alice/profile", { name: "Alice", version: 1 }]]),
      ]);

      // Overwrite with new data (second write to same URI wins)
      await node.receive([
        msg([["store://users/alice/profile", {
          name: "Alice Updated",
          version: 2,
        }]]),
      ]);

      // Verify data was updated
      const readResults = await node.read("store://users/alice/profile");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice Updated",
        version: 2,
      });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive with null data in output`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const results = await node.receive([
        msg([["store://users/test/null", null]]),
      ]);

      assertEquals(typeof results[0].accepted, "boolean");
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - read with trailing slash lists children`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const prefix = `store://users/node-list-${Date.now()}`;
      await node.receive([
        msg([[`${prefix}/alice/profile`, { name: "Alice" }]]),
        msg([[`${prefix}/bob/profile`, { name: "Bob" }]]),
        msg([[`${prefix}/charlie/profile`, { name: "Charlie" }]]),
      ]);

      const results = await node.read(`${prefix}/`);

      assertEquals(
        results.length >= 3,
        true,
        `Should return at least 3 items, got ${results.length}`,
      );
      const successResults = results.filter((r) => r.success);
      assertEquals(
        successResults.length >= 3,
        true,
        "Should have at least 3 successful reads",
      );
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - read multiple URIs`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      await node.receive([
        msg([["store://users/alice/profile", { name: "Alice" }]]),
        msg([["store://users/bob/profile", { name: "Bob" }]]),
      ]);

      const results = await node.read([
        "store://users/alice/profile",
        "store://users/bob/profile",
        "store://users/nonexistent/profile",
      ]);

      assertEquals(results.length, 3);

      assertEquals(results[0].success, true);
      if (results[0].success) {
        assertEquals(results[0].record?.data, { name: "Alice" });
      }
      assertEquals(results[1].success, true);
      if (results[1].success) {
        assertEquals(results[1].record?.data, { name: "Bob" });
      }
      assertEquals(
        results[2].success,
        false,
        "Nonexistent URI should fail",
      );
    },
  });

  // Validation error tests (if factory provided)
  if (factory.validationError) {
    Deno.test({
      name: `${suiteName} [Node] - receive validation error`,
      ...noSanitize,
      fn: async () => {
        const node = await Promise.resolve(factory.validationError!());

        const results = await node.receive([
          msg([["store://users/invalid/data", { invalid: true }]]),
        ]);

        assertEquals(results[0].accepted, false);
        assertEquals(typeof results[0].error, "string");
      },
    });
  }
}

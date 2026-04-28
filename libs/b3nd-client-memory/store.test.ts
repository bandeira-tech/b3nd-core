/**
 * MemoryStore Tests
 *
 * Runs the shared Store test suite + MemoryStore-specific tests.
 * Observe is a client concern (see ObserveEmitter) — not tested here.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { runSharedStoreSuite } from "../b3nd-testing/shared-store-suite.ts";
import { MemoryStore } from "./store.ts";

// ── Shared suite ──────────────────────────────────────────────────

runSharedStoreSuite("MemoryStore", {
  create: () => new MemoryStore(),
});

// ── Capabilities ──────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - capabilities shape",
  fn: () => {
    const store = new MemoryStore();
    const caps = store.capabilities();
    assertEquals(caps.atomicBatch, false);
    assertEquals(caps.binaryData, false);
  },
});

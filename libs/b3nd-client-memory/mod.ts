/**
 * Memory backend for b3nd.
 *
 * In-memory Store implementation. No executor needed.
 */

import type { Program } from "../b3nd-core/types.ts";

export { MemoryStore } from "./store.ts";

/**
 * Create a permissive test program set that classifies every message
 * under common URI prefixes as `{ code: "ok" }` — no rejections. Handy
 * for rig tests that want the pipeline running without caring about
 * message-level validation.
 */
export function createTestPrograms(): Record<string, Program> {
  // deno-lint-ignore require-await
  const acceptAll: Program = async () => ({ code: "ok" });
  return {
    "mutable://accounts": acceptAll,
    "mutable://open": acceptAll,
    "mutable://data": acceptAll,
    "immutable://accounts": acceptAll,
    "immutable://open": acceptAll,
    "immutable://data": acceptAll,
  };
}

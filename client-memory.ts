/**
 * @module
 * MemoryStore subpath — in-process Store with no external dependencies.
 *
 * Useful for tests, ephemeral browser caches, and small embedded apps.
 * Wrap with `SimpleClient`, `DataStoreClient`, or `FunctionalClient`
 * (from the root export) to get a `ProtocolInterfaceNode`.
 */

export { MemoryStore } from "./libs/b3nd-client-memory/store.ts";

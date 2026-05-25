/**
 * @module
 * Connection — a client bound to an `Acceptance` predicate.
 *
 * A `Connection` pairs a `ProtocolInterfaceNode` with the question
 * "does this URI route here?" That question is answered by an
 * `Acceptance` (see `./acceptance.ts`) — pattern lists are the common
 * case, but any predicate works.
 *
 * Connections are bound into the rig's `routes` config (`receive`,
 * `read`, `observe`) — each route gets its own ordered list. The same
 * connection value can be referenced from multiple routes (when one
 * client serves writes, reads, and observes with the same filter); a
 * different filter for a different op means a separate
 * `connection(...)` call.
 *
 * For ergonomics, `connection(client, patternList)` keeps working —
 * the string array is shorthand for `patterns(...patternList)`. Pass
 * an explicit `Acceptance` (`prefix("…")`, `schemas("…")`, a custom
 * predicate) when you need anything beyond the pattern grammar.
 *
 * @example A single client serving all three ops (pattern shorthand)
 * ```ts
 * import { connection, Rig } from "@bandeira-tech/b3nd-sdk";
 *
 * const node = connection(httpClient, ["mutable://*", "hash://*"]);
 *
 * const rig = new Rig({
 *   routes: {
 *     receive: [node],
 *     read:    [node],
 *     observe: [node],
 *   },
 * });
 * ```
 *
 * @example Explicit Acceptance — schema-driven routing
 * ```ts
 * import { connection, schemas } from "@bandeira-tech/b3nd-sdk";
 *
 * const notify = connection(webhookClient, schemas("notify"));
 * ```
 */

import type { ProtocolInterfaceNode } from "../types/types.ts";
import type { Acceptance } from "./acceptance.ts";
import { patterns as patternsAcceptance } from "./acceptance.ts";

// ── Types ──

/** Optional configuration for a connection. */
export interface ConnectionOptions {
  /**
   * Stable identifier for this connection. Surfaces in
   * `route:success`/`route:error` events on the operation handle and
   * lets operators tell replicas apart in observability data.
   * Auto-generated as `conn-{N}` (registration order) when omitted.
   */
  id?: string;
}

/** A connection: a client paired with an Acceptance and a stable id. */
export interface Connection extends Acceptance {
  /** Stable identifier (provided or auto-generated). */
  readonly id: string;

  /** The underlying client. */
  readonly client: ProtocolInterfaceNode;

  /**
   * Back-compat accessor — exposes the underlying pattern list when
   * the connection was built from one. Returns `undefined` for
   * connections built from an arbitrary `Acceptance` whose
   * `describe()` is not a `string[]`.
   *
   * @deprecated Prefer `accepts()` for routing decisions and
   * `describe()` for wire publication. This slot is kept for
   * compatibility with existing consumers that read patterns directly.
   */
  readonly patterns?: readonly string[];
}

// ── connection ──

/** Module-level counter for auto-generated connection IDs. */
let _autoIdCounter = 0;

/**
 * Wrap a client with an `Acceptance` (or a pattern shorthand) to
 * create a connection.
 *
 * The connection is the gateway control — the rig uses it for routing
 * within the route arrays it appears in, and `acceptance.describe()`
 * can be published over the wire for remote filtering when it
 * produces a recognized descriptor (canonically: `string[]`).
 *
 * Local enforcement is always applied. Remote enforcement is
 * best-effort: the remote node may or may not honor the descriptor.
 */
export function connection(
  client: ProtocolInterfaceNode,
  acceptance: Acceptance | string[],
  options?: ConnectionOptions,
): Connection {
  const a: Acceptance = Array.isArray(acceptance)
    ? patternsAcceptance(...acceptance)
    : acceptance;

  const id = options?.id ?? `conn-${_autoIdCounter++}`;

  // Surface the pattern list for back-compat readers when the
  // descriptor is a plain string[].
  const described = a.describe?.();
  const patternList = isStringArray(described)
    ? Object.freeze([...described]) as readonly string[]
    : undefined;

  return {
    id,
    client,
    patterns: patternList,
    accepts: (uri: string) => a.accepts(uri),
    describe: a.describe?.bind(a),
  };
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

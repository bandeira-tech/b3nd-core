/**
 * @module
 * Connection — a client bound to a URI pattern list.
 *
 * A `Connection` wraps a `ProtocolInterfaceNode` with a set of URI
 * filter patterns. Connections are bound into the rig's `routes`
 * config (`receive`, `read`, `observe`) — each route gets its own
 * ordered list of connections.
 *
 * The same connection value can be referenced from multiple routes
 * (when one client serves writes, reads, and observes with the same
 * filter); a different filter for a different op means a separate
 * `connection(...)` call.
 *
 * Pattern syntax (same as observe and reactions):
 * - `*` matches exactly one non-empty segment
 * - `**` matches zero or more remaining segments (final segment only)
 * - Literal segments must match exactly
 *
 * @example A single client serving all three ops
 * ```ts
 * import { connection, Rig } from "@bandeira-tech/b3nd-core";
 *
 * const node = connection(httpClient, ["mutable://**", "hash://**"]);
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
 * @example Asymmetric topology — write-mirror, read-cache, narrow observe
 * ```ts
 * const primary = connection(httpClient,  ["mutable://**", "hash://**"], { id: "primary" });
 * const mirror  = connection(pgClient,    ["mutable://**", "hash://**"], { id: "mirror"  });
 * const cache   = connection(redisClient, ["mutable://accounts/**"],   { id: "cache"   });
 * const obsNarrow = connection(httpClient, ["mutable://**"],            { id: "primary-obs" });
 *
 * const rig = new Rig({
 *   routes: {
 *     receive: [primary, mirror], // broadcast both
 *     read:    [cache, primary],  // cache wins on match; primary for the rest (first-match-wins)
 *     observe: [obsNarrow],       // narrow namespace, primary only
 *   },
 * });
 * ```
 */

import type { ProtocolInterfaceNode } from "../types/types.ts";
import {
  compilePattern,
  type Matcher,
} from "../match-pattern/match-pattern.ts";

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

/**
 * A connection: a client wrapped with a URI pattern list.
 *
 * Generic over the client's node type. Defaults to
 * `ProtocolInterfaceNode` so bare `Connection` keeps meaning "full
 * node", but a narrower client (e.g. a receive-only node) is preserved
 * as `Connection<{ receive; status }>` — which the rig's per-verb route
 * slots use to reject mis-wiring at compile time.
 */
export interface Connection<T = ProtocolInterfaceNode> {
  /** Stable identifier (provided or auto-generated). */
  readonly id: string;

  /** The underlying client. */
  readonly client: T;

  /**
   * The raw patterns — serializable for wire protocols.
   * Send this to a remote node so it knows what to push.
   */
  readonly patterns: readonly string[];

  /** Check if this connection's pattern list accepts a URI. */
  accepts(uri: string): boolean;
}

// ── Internals ──

function matchesAny(matchers: Matcher[], uri: string): boolean {
  for (let i = 0; i < matchers.length; i++) {
    if (matchers[i](uri)) return true;
  }
  return false;
}

// ── connection ──

/** Module-level counter for auto-generated connection IDs. */
let _autoIdCounter = 0;

/**
 * Wrap a client with a URI pattern list to create a connection.
 *
 * The connection is the gateway control — the rig uses it for
 * routing within the route arrays it appears in, and the patterns
 * can be published over the wire for remote filtering.
 *
 * Local enforcement is always applied. Remote enforcement is
 * best-effort: the remote node may or may not honor the patterns,
 * but the local rig always filters based on them.
 */
export function connection<T = ProtocolInterfaceNode>(
  client: T,
  patterns: string[],
  options?: ConnectionOptions,
): Connection<T> {
  const matchers = patterns.map(compilePattern);
  const frozenPatterns = Object.freeze([...patterns]) as readonly string[];
  const id = options?.id ?? `conn-${_autoIdCounter++}`;

  return {
    id,
    client,
    patterns: frozenPatterns,

    accepts(uri: string): boolean {
      return matchesAny(matchers, uri);
    },
  };
}

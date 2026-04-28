/**
 * @module
 * Connection — the single filtering primitive for b3nd.
 *
 * A connection wraps a client with URI patterns that describe what
 * this gateway accepts. The rig routes operations based on connections.
 *
 * The same connection descriptor is:
 * - Used locally by the rig for routing decisions
 * - Serializable for publishing over the wire (WS, HTTP, etc.)
 * - Enforced locally regardless of whether the remote honors it
 *
 * Pattern syntax (same as observe):
 * - `:param` matches a single segment
 * - `*` matches one or more remaining segments
 * - Literal segments must match exactly
 *
 * @example
 * ```ts
 * import { connection } from "./connection.ts";
 *
 * // Full b3nd node
 * const node = connection(httpClient, {
 *   receive: ["mutable://*", "immutable://*", "hash://*"],
 *   read:    ["mutable://*", "immutable://*", "hash://*"],
 *   observe: ["mutable://*"],
 * });
 *
 * // List reads piggyback on `read` — a trailing-slash URI is
 * // matched against `read` patterns with the slash stripped.
 *
 * // Write-only mirror
 * const mirror = connection(pgClient, {
 *   receive: ["mutable://*", "hash://*"],
 * });
 *
 * // Read-only cache
 * const cache = connection(redisClient, {
 *   read: ["mutable://accounts/*", "hash://sha256/*"],
 * });
 *
 * // Rig routes to the right connections automatically
 * const rig = new Rig({
 *   connections: [node, mirror, cache],
 *   schema: mySchema,
 * });
 * ```
 */

import type {
  ClientOperation,
  ProtocolInterfaceNode,
} from "../b3nd-core/types.ts";
import { matchPattern } from "./reactions.ts";

// ── Types ──

/** Per-operation URI patterns. Only listed operations are routed. */
export interface ConnectionPatterns {
  receive?: string[];
  read?: string[];
  observe?: string[];
}

/** Optional configuration for a connection. */
export interface ConnectionOptions {
  /**
   * Stable identifier for this connection. Surfaces in
   * `route:success`/`route:error` events and lets operators tell
   * replicas apart in observability data. Auto-generated as
   * `conn-{N}` (registration order) when omitted.
   */
  id?: string;
}

/** A connection: a client wrapped with routing patterns. */
export interface Connection {
  /** Stable identifier (provided or auto-generated). */
  readonly id: string;

  /** The underlying client. */
  readonly client: ProtocolInterfaceNode;

  /**
   * The raw patterns — serializable for wire protocols.
   * Send this to a remote node so it knows what to push.
   */
  readonly patterns: Readonly<{
    receive?: readonly string[];
    read?: readonly string[];
    observe?: readonly string[];
  }>;

  /** Check if this connection accepts an operation on a URI. */
  accepts(operation: ClientOperation, uri: string): boolean;
}

// ── Internals ──

/** Pre-compiled pattern: pre-split segments for fast matching. */
interface CompiledPattern {
  segments: string[];
}

function compilePatterns(patterns: string[]): CompiledPattern[] {
  return patterns.map((p) => ({ segments: p.split("/") }));
}

function matchesAny(compiled: CompiledPattern[], uri: string): boolean {
  for (const { segments } of compiled) {
    if (matchPattern(segments, uri) !== null) return true;
  }
  return false;
}

// ── connection ──

/**
 * Wrap a client with routing patterns to create a connection.
 *
 * The connection is the gateway control — the rig uses it for routing,
 * and the patterns can be published over the wire for remote filtering.
 *
 * Local enforcement is always applied. Remote enforcement is best-effort:
 * the remote node may or may not honor the patterns, but the local rig
 * always filters based on them.
 */
/** Module-level counter for auto-generated connection IDs. */
let _autoIdCounter = 0;

export function connection(
  client: ProtocolInterfaceNode,
  patterns: ConnectionPatterns,
  options?: ConnectionOptions,
): Connection {
  // Pre-compile patterns for fast matching
  const compiled: Partial<Record<ClientOperation, CompiledPattern[]>> = {};
  for (const op of ["receive", "read", "observe"] as const) {
    if (patterns[op]) {
      compiled[op] = compilePatterns(patterns[op]!);
    }
  }

  // Deep-copy and freeze patterns so they're safe to serialize
  const frozenPatterns = Object.freeze({
    ...(patterns.receive
      ? { receive: Object.freeze([...patterns.receive]) }
      : {}),
    ...(patterns.read ? { read: Object.freeze([...patterns.read]) } : {}),
    ...(patterns.observe
      ? { observe: Object.freeze([...patterns.observe]) }
      : {}),
  });

  const id = options?.id ?? `conn-${_autoIdCounter++}`;

  return {
    id,
    client,
    patterns: frozenPatterns,

    accepts(operation: ClientOperation, uri: string): boolean {
      const opPatterns = compiled[operation];
      if (!opPatterns) return false;
      return matchesAny(opPatterns, uri);
    },
  };
}

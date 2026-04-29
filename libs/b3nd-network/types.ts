/**
 * @module
 * Types for `@bandeira-tech/b3nd-sdk/network`.
 *
 * Two mental primitives, both just functions over a peer list:
 *
 * - **`network(target, peers, policies?, opts?)`** — participant verb.
 *   Subscribes each peer's observe stream, passes events through the
 *   (optional) chain of `Policy.receive` hooks, and forwards yielded
 *   events into `target.receive`. Returns an async unbind.
 *
 * - **Strategy factories** (`flood(peers)`, `pathVector(peers)`, …) —
 *   remote-client shape. Each factory returns a
 *   `ProtocolInterfaceNode` consumed as a rig connection:
 *   `connection(flood(peers), patterns)`.
 *
 * `network()` and the strategy factories are entirely different shapes
 * (a verb vs. a ProtocolInterfaceNode), so they cannot be accidentally
 * swapped.
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
} from "../b3nd-core/types.ts";

/**
 * A peer is a client plus a stable id used for local routing control.
 *
 * The id is always present — auto-generated at runtime via `peer()` when
 * not supplied. Protocols that key on cryptographic identity (e.g.,
 * path-vector loop avoidance) pass their pubkey hex as the id explicitly.
 *
 * The id is not advertised on the wire by the network itself; it is
 * purely local bookkeeping used by strategy factories and Policies.
 */
export interface Peer {
  readonly id: string;
  readonly client: ProtocolInterfaceNode;
}

/**
 * A PeerDecorator wraps a client with middleware (best-effort, retry,
 * rate-limit, logging, etc.) while preserving the `ProtocolInterfaceNode`
 * shape. Applied via `peer(client, { via: [decoratorA, decoratorB] })`.
 */
export type PeerDecorator = (
  client: ProtocolInterfaceNode,
) => ProtocolInterfaceNode;

/**
 * Context passed to `Policy.receive` — inbound path, peer → rig.
 *
 * Carries only information the bridge uniquely knows at call time. Any
 * data sources a policy needs (local store, cache, index, etc.) are
 * the policy's own concern and should be injected at its construction.
 */
export interface InboundCtx {
  /** Local identity for this network invocation. */
  readonly originId: string;
  /** The peer this event came from. `source.client` exposes `read`/`receive`
   *  for side-requests to the sender (e.g., pulling a full payload after
   *  an announcement). */
  readonly source: Peer;
}

/**
 * A Policy shapes how the `network()` verb translates inbound peer
 * events before feeding them into the target rig. It is scoped to the
 * participant side — strategy factories (flood, pathVector, etc.)
 * encapsulate their own outbound behavior and do not consult a Policy.
 *
 * Multiple policies can be passed as an array to `network()`; their
 * `receive` hooks are chained left-to-right (each yielded event flows
 * through the next policy).
 */
export interface Policy {
  /**
   * Per-event transform on the inbound path. Yield zero or more events
   * that should be delivered into the consuming target's pipeline.
   *
   * The async-generator shape lets the policy:
   *  - consume a control-plane event silently (yield nothing)
   *  - trigger a side-read from the source peer (via `source.client.read`)
   *    and yield the fetched content to the target
   *  - pass the event through unchanged
   */
  receive?(
    ev: ReadResult<unknown>,
    source: Peer,
    ctx: InboundCtx,
  ): AsyncIterable<ReadResult<unknown>>;
}

/**
 * Options passed to the `network()` verb — strictly bridge-level concerns.
 */
export interface NetworkOptions {
  /**
   * Observe pattern subscribed to on each peer. Defaults to `"*"` —
   * every event is bridged. Narrow to reduce noise in busy networks.
   */
  pattern?: string;

  /**
   * Called when a peer's observe stream or `target.receive` throws.
   * Defaults to a silent catch so one bad peer/message does not tear
   * down the whole bridge.
   */
  onError?: (err: Error, ctx: { peerId?: string }) => void;
}

/**
 * A StrategyFactory builds a plain `ProtocolInterfaceNode` from a peer
 * list. Examples: `flood(peers)` (fan-out to all, first-match reads),
 * `pathVector(peers)` (flood with signer-chain loop avoidance).
 *
 * The returned value is an ordinary client and goes into a rig
 * connection list unchanged:
 *
 * ```ts
 * connection(flood(peers), ["*"])
 * ```
 */
export type StrategyFactory = (peers: Peer[]) => ProtocolInterfaceNode;

// Re-export Message for policy hook signatures that need it.
export type { Message };

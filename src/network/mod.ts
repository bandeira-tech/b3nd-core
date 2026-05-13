/**
 * @module @bandeira-tech/b3nd-sdk/network
 *
 * Peer-network primitives.
 *
 * - **`network(target, peers, policies?, opts?)`** — the participant
 *   verb. Subscribes peer observe streams, applies Policy chains, and
 *   forwards into the target's receive pipeline.
 * - **Strategy factories** — `flood(peers)`, `pathVector(peers)`, …
 *   Build plain `ProtocolInterfaceNode` clients from a peer list for
 *   use as rig connections via `connection(factory(peers), patterns)`.
 *
 * See README for the three deployment modes.
 */

export type {
  InboundCtx,
  Message,
  NetworkOptions,
  Peer,
  PeerDecorator,
  Policy,
  StrategyFactory,
} from "./types.ts";
export { peer } from "./peer.ts";
export { network } from "./network.ts";

// ── Peer decorators ──────────────────────────────────────────────────
export { bestEffort } from "./decorators.ts";

// ── Strategy factories (remote-client shape) ─────────────────────────
export { flood } from "./policies/flood.ts";
export { pathVector } from "./policies/path-vector.ts";

// ── Sync patterns ────────────────────────────────────────────────────
export { tellAndRead } from "./policies/tell-and-read.ts";
export type {
  TellAndReadBundle,
  TellAndReadOptions,
} from "./policies/tell-and-read.ts";

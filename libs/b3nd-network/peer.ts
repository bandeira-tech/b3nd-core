/**
 * @module
 * `peer()` — construct a Peer from a client, optionally applying decorators
 * and pinning an explicit id.
 */

import type { ProtocolInterfaceNode } from "../b3nd-core/types.ts";
import type { Peer, PeerDecorator } from "./types.ts";

/**
 * Create a Peer from a client.
 *
 * @example
 * ```ts
 * // Anonymous peer — id auto-assigned at runtime
 * peer(new HttpClient({ url: "https://node-b" }))
 *
 * // Protocol with path-vector loop avoidance — id matches the peer's pubkey
 * peer(client, { id: peerPubkeyHex })
 *
 * // Stack middleware
 * peer(client, { via: [bestEffort, rateLimited(10)] })
 * ```
 */
export function peer(
  client: ProtocolInterfaceNode,
  opts: { id?: string; via?: PeerDecorator[] } = {},
): Peer {
  const id = opts.id ?? `peer-${crypto.randomUUID()}`;
  const decorated = (opts.via ?? []).reduce<ProtocolInterfaceNode>(
    (c, decorator) => decorator(c),
    client,
  );
  return { id, client: decorated };
}

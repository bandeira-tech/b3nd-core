/**
 * @module
 * Peer decorators — middleware that wraps a client while preserving the
 * `ProtocolInterfaceNode` shape. Applied via `peer(client, { via: [decorator] })`.
 */

import type { ProtocolInterfaceNode } from "../b3nd-core/types.ts";
import type { PeerDecorator } from "./types.ts";

/**
 * Swallow `receive()` errors and report them as accepted.
 *
 * Use for best-effort push: when you want a one-peer failure to be
 * logged and otherwise ignored rather than aborting the whole fan-out.
 * Every other method (read, observe, status) is passed through
 * unchanged so bridges and observers behave normally.
 *
 * ```ts
 * peer(new HttpClient({ url }), { via: [bestEffort] })
 * ```
 */
export const bestEffort: PeerDecorator = (
  client: ProtocolInterfaceNode,
): ProtocolInterfaceNode => ({
  async receive(msgs) {
    try {
      return await client.receive(msgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[peer] best-effort receive failed: ${msg}`);
      return msgs.map(() => ({ accepted: true }));
    }
  },
  read: (uris) => client.read(uris),
  observe: (pattern, signal) => client.observe(pattern, signal),
  status: () => client.status(),
});

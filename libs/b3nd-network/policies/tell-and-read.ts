/**
 * @module
 * `tellAndRead(opts)` — INV/READ-style content synchronization.
 *
 * The pattern: instead of pushing full payloads to every peer, announce
 * what you have with a small message; peers that want the content pull
 * it via the existing `read()` primitive (no separate GETDATA message).
 *
 * ```
 *   A writes M                            B observes A's announcement
 *        │                                        │
 *        ▼                                        ▼
 *   outbound announce                      inbound onAnnounce
 *   ─────────────────                      ──────────────────
 *   transform full msg                     parse announcement;
 *   into inv/ announcement                 pull full content
 *   sent to peers                          via source.client.read
 *        │                                        │
 *        ▼                                        ▼
 *   peers see inv/ only                    content flows into
 *   (cheap over the wire)                  rig.receive pipeline
 * ```
 *
 * This is URI-agnostic. The protocol decides:
 * - What an "announcement" looks like (`announce`).
 * - How to recognize one and which URI(s) to pull (`onAnnounce`).
 *
 * The "pull" leg is the existing peer `client.read()` — the remote
 * side's read handler serves the payload with whatever auth/access it
 * already enforces. No GETDATA message, no new transport, no new
 * surface area to reason about.
 *
 * ## Shape
 *
 * `tellAndRead()` returns a pair: an outbound strategy factory
 * (`outbound(peers)` → `ProtocolInterfaceNode`) and an inbound Policy.
 * Use them on their respective sides:
 *
 * ```ts
 * const sync = tellAndRead({
 *   announce: (msgs) => msgs.map(([uri, vals, data]) =>
 *     uri.startsWith("hash://")
 *       ? [`net://inv/${uri}`, { have: uri }]
 *       : [uri, vals, data]
 *   ),
 *   onAnnounce: (ev) => {
 *     if (ev.uri?.startsWith("net://inv/")) {
 *       return [(ev.record?.data as { have: string }).have];
 *     }
 *     return null;
 *   },
 * });
 *
 * const rig = new Rig({
 *   connections: [
 *     connection(localStore, { receive: ["*"], read: ["*"] }),
 *     connection(sync.outbound(peers), { receive: ["hash://*"] }),
 *   ],
 * });
 * const unbind = network(rig, peers, [sync.inbound]);
 * ```
 *
 * ## Batching
 *
 * `announce` runs on the full per-peer batch, so the protocol can
 * choose per-item announcements, a single compound announcement
 * carrying many URIs, or per-peer asymmetry (full to trusted, INV to
 * untrusted). `onAnnounce` returns a list of URIs so multi-item
 * announcements fan the pulls out naturally.
 *
 * ## What stays the protocol's responsibility
 *
 * - URI layout for the control plane (`net://inv/...`, `inv://...`,
 *   `...?inv=true`, however you want).
 * - Detection (which URIs are announcements vs. data).
 * - "I already have this" short-circuit: `onAnnounce` closes over the
 *   protocol's local store to decide whether to return the URI to
 *   pull. The network layer doesn't plumb a local accessor.
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
} from "../../b3nd-core/types.ts";
import type { Peer, Policy } from "../types.ts";
import { validatePeers } from "../network.ts";
import { floodImpl } from "./flood.ts";

export interface TellAndReadOptions {
  /**
   * Transform outbound messages per peer. Return the messages that
   * should actually be sent to this peer: pass-through (`msgs`), a
   * filtered subset, or rewritten announcements. Return `[]` to skip
   * the peer entirely.
   *
   * Defaults to identity — `tellAndRead` without an `announce` is
   * effectively `flood` on the outbound side.
   */
  announce?: (msgs: Message[], peer: Peer) => Message[];

  /**
   * Examine an inbound event. Return:
   * - `null` / `undefined` — not an announcement. The event passes
   *   through to the target unchanged.
   * - `string[]` — URIs to pull from the source peer via
   *   `source.client.read`. The fetched content replaces the
   *   announcement in the inbound stream. Return `[]` to consume the
   *   announcement without pulling anything (e.g., "I already have it").
   */
  onAnnounce?: (
    ev: ReadResult<unknown>,
    source: Peer,
  ) => Promise<string[] | null> | string[] | null;
}

export interface TellAndReadBundle {
  /** Strategy factory — build the outbound PIN for `connection()`. */
  outbound: (peers: Peer[]) => ProtocolInterfaceNode;
  /** Participant-side Policy — pass to `network(rig, peers, [bundle.inbound])`. */
  inbound: Policy;
}

/**
 * Construct a matched outbound/inbound pair for INV/READ-style sync.
 */
export function tellAndRead(opts: TellAndReadOptions): TellAndReadBundle {
  const { announce, onAnnounce } = opts;

  return {
    outbound(peers) {
      const { originId, peers: frozen } = validatePeers(peers);
      const transform = announce
        ? (msgs: Message[], peer: Peer) => announce(msgs, peer)
        : (msgs: Message[]) => msgs;
      return floodImpl(originId, frozen, transform);
    },

    inbound: {
      async *receive(ev, source) {
        if (!onAnnounce) {
          yield ev;
          return;
        }
        const result = await Promise.resolve(onAnnounce(ev, source));
        if (result == null) {
          // Not an announcement — pass through.
          yield ev;
          return;
        }
        // It's an announcement (possibly empty). Pull each listed URI
        // in parallel — announcements carrying many URIs (compact
        // block-style) shouldn't serialize into a chain of RTTs.
        const pulls = await Promise.all(
          result.map(async (uri) => ({
            uri,
            results: await source.client.read<unknown>(uri),
          })),
        );
        for (const { uri, results } of pulls) {
          for (const r of results) {
            if (r.success) yield { ...r, uri };
          }
        }
      },
    },
  };
}

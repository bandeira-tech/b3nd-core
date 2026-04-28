/**
 * @module
 * `pathVector(peers)` — flood with signer-chain loop avoidance.
 *
 * Returns the same shape as `flood(peers)` but filters the outbound fan
 * per-peer: before sending a message to peer P, inspect
 * `data.auth[*].pubkey` on the message (the signer chain of an
 * `AuthenticatedMessage`-shaped payload); if P's id appears in that
 * chain, skip P — they have already seen (or signed) the message.
 *
 * Handles arbitrary-length cycles (A → B → C → A) without any state,
 * because the chain grows with every relay that re-signs. Works "for
 * free" when messages are signed with `Identity.sign()` + `message()`.
 *
 * ## Peer id convention
 *
 * For this to work, each `peer.id` must equal the peer's signing pubkey
 * (typically the hex-encoded Ed25519 key):
 *
 * ```ts
 * peer(client, { id: peerPubkeyHex })
 * ```
 *
 * Auto-assigned UUID ids never match any signer and the filter becomes
 * a no-op — pathVector then degenerates to plain `flood`.
 *
 * ## Scope
 *
 * pathVector only *reads* the chain. It does not add the local
 * identity's signature on relay — that's the application's responsibility.
 */

import type { Message, ProtocolInterfaceNode } from "../../b3nd-core/types.ts";
import type { Peer } from "../types.ts";
import { validatePeers } from "../network.ts";
import { floodImpl } from "./flood.ts";

export function pathVector(peers: Peer[]): ProtocolInterfaceNode {
  const { originId, peers: frozenPeers } = validatePeers(peers);
  return floodImpl(
    originId,
    frozenPeers,
    (msgs, peer) => msgs.filter((m) => !signerChain(m).includes(peer.id)),
  );
}

/**
 * Extract the list of signer pubkeys from an `AuthenticatedMessage`-
 * shaped payload. Returns `[]` for any payload that doesn't carry an
 * `auth` array — non-authenticated messages flow freely.
 */
function signerChain(msg: Message): string[] {
  const [, payload] = msg;
  if (!payload || typeof payload !== "object") return [];
  const auth = (payload as { auth?: unknown }).auth;
  if (!Array.isArray(auth)) return [];
  const keys: string[] = [];
  for (const entry of auth) {
    const pubkey = (entry as { pubkey?: unknown } | null)?.pubkey;
    if (typeof pubkey === "string") keys.push(pubkey);
  }
  return keys;
}

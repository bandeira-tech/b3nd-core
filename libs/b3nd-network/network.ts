/**
 * @module
 * `network(target, peers, policies?, opts?)` — the participant verb.
 *
 * Subscribes each peer's observe stream, passes events through the
 * (optional) chain of `Policy.receive` hooks, and forwards yielded
 * events into `target.receive`. Returns an async unbind that aborts
 * every peer loop and awaits clean teardown.
 *
 * ```ts
 * import { network, peer, pathVector } from "@bandeira-tech/b3nd-sdk/network";
 *
 * const unbind = network(rig, peers);                           // no policies
 * const unbind = network(rig, peers, [myPolicy]);               // one policy
 * const unbind = network(rig, peers, [filter, tellAndRead], {   // multiple, chained
 *   pattern: "mutable://chat/*",
 * });
 *
 * await unbind();
 * ```
 *
 * `network()` is not a `ProtocolInterfaceNode`. Passing a peer list to
 * a strategy factory (`flood(peers)`, `pathVector(peers)`) is how you
 * build the remote-client shape for `connection()`.
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
} from "../b3nd-core/types.ts";
import type { InboundCtx, NetworkOptions, Peer, Policy } from "./types.ts";

/**
 * Wire peers into a target's `receive` pipeline.
 *
 * Returns an async unbind; calling it aborts each peer's observe signal
 * and awaits the per-peer loops so teardown is resource-sanitizer-clean.
 * Idempotent — calling twice is a no-op.
 */
export function network(
  target: Pick<ProtocolInterfaceNode, "receive">,
  peers: Peer[],
  policies: Policy[] = [],
  opts: NetworkOptions = {},
): () => Promise<void> {
  const { originId, peers: frozenPeers } = validatePeers(peers);
  const pattern = opts.pattern ?? "*";
  const onError = opts.onError ?? (() => {});
  const ac = new AbortController();

  const tasks = frozenPeers.map((peer) =>
    runPeer(peer, policies, originId, target, pattern, ac.signal, onError)
  );

  let unbound = false;
  return async () => {
    if (unbound) return;
    unbound = true;
    ac.abort();
    await Promise.allSettled(tasks);
  };
}

/**
 * Shared peer-list validation. Exported for strategy factories that
 * want the same uniqueness / non-empty guarantees.
 *
 * @internal
 */
export function validatePeers(
  peers: Peer[],
): { originId: string; peers: readonly Peer[] } {
  if (!peers || peers.length === 0) {
    throw new Error("peers[] must be non-empty");
  }
  const ids = new Set<string>();
  for (const p of peers) {
    if (ids.has(p.id)) {
      throw new Error(`duplicate peer id "${p.id}"`);
    }
    ids.add(p.id);
  }
  return {
    originId: `net-${crypto.randomUUID()}`,
    peers: Object.freeze([...peers]),
  };
}

// ── Internals: the bridge ─────────────────────────────────────────────

/**
 * One peer's subscription loop. Kept as a separate function (not an
 * inline IIFE) so error stacks identify the misbehaving peer.
 */
async function runPeer(
  peer: Peer,
  policies: Policy[],
  originId: string,
  target: Pick<ProtocolInterfaceNode, "receive">,
  pattern: string,
  signal: AbortSignal,
  onError: (err: Error, ctx: { peerId?: string }) => void,
): Promise<void> {
  const ctx: InboundCtx = { originId, source: peer };
  const hooks = policies
    .map((p) => p.receive?.bind(p))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  try {
    for await (const ev of peer.client.observe(pattern, signal)) {
      if (signal.aborted) break;
      for await (const out of foldReceive(ev, hooks, peer, ctx)) {
        if (signal.aborted) break;
        await forward(target, out, onError, peer.id);
      }
    }
  } catch (err) {
    onError(toError(err), { peerId: peer.id });
  }
}

/**
 * Fold `hooks` over `ev`: apply `hooks[0]` to `ev`, then `hooks[1]` to
 * each event yielded, and so on. The result is one merged stream of
 * events the target should receive.
 */
async function* foldReceive(
  ev: ReadResult<unknown>,
  hooks: Array<
    (
      ev: ReadResult<unknown>,
      source: Peer,
      ctx: InboundCtx,
    ) => AsyncIterable<ReadResult<unknown>>
  >,
  source: Peer,
  ctx: InboundCtx,
): AsyncIterable<ReadResult<unknown>> {
  if (hooks.length === 0) {
    yield ev;
    return;
  }
  const [first, ...rest] = hooks;
  for await (const out of first(ev, source, ctx)) {
    yield* foldReceive(out, rest, source, ctx);
  }
}

/** Forward one event into the target's `receive`. Swallows errors via `onError`. */
async function forward(
  target: Pick<ProtocolInterfaceNode, "receive">,
  ev: ReadResult<unknown>,
  onError: (err: Error, ctx: { peerId?: string }) => void,
  peerId: string,
): Promise<void> {
  if (!ev.uri || !ev.record) return;
  const msg: Message = [ev.uri, ev.record.data];
  try {
    await target.receive([msg]);
  } catch (err) {
    onError(toError(err), { peerId });
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

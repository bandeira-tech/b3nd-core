/**
 * @module
 * `flood(peers)` — the baseline remote-client strategy.
 *
 * Returns a `ProtocolInterfaceNode` that:
 * - **receive**: fans every write out to every peer in parallel
 * - **read**: tries peers in order and returns the first successful hit
 * - **observe**: merges every peer's observe stream into one iterator
 * - **status**: aggregates peer health (healthy / degraded / unhealthy)
 *
 * Use as a rig connection:
 *
 * ```ts
 * import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";
 * import { Rig, connection, HttpClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const rig = new Rig({
 *   connections: [
 *     connection(
 *       flood([peer(new HttpClient({ url: "https://node-b" }))]),
 *       { receive: ["*"], read: ["*"], observe: ["*"] },
 *     ),
 *   ],
 * });
 * ```
 *
 * For bidirectional signed meshes that need loop avoidance, use
 * `pathVector(peers)` instead — same shape, plus a signer-chain filter
 * on outbound.
 *
 * ## Error handling
 *
 * - `receive` propagates transport-level failures — one peer rejecting
 *   aborts the fan-out. Wrap individual peers with the `bestEffort`
 *   decorator if you want per-peer failures to be non-fatal.
 * - `read` falls through: a failing peer is skipped, and if no peer
 *   returns a hit the result is a `not-found` per input URI.
 * - `observe` silently drops a peer whose stream throws (the merged
 *   stream keeps flowing from the remaining peers). This is
 *   intentional — `flood` is a one-shot PIN with no `onError` hook.
 *   For observability over the inbound side, use `network()`, which
 *   accepts an `onError` callback and reports per-peer failures.
 * - `status` aggregates; individual unhealthy peers degrade the
 *   overall status rather than throwing.
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../../b3nd-core/types.ts";
import type { Peer } from "../types.ts";
import { validatePeers } from "../network.ts";

/**
 * Build a flood PIN from peers. Peers must have unique ids and the list
 * must be non-empty.
 */
export function flood(peers: Peer[]): ProtocolInterfaceNode {
  const { originId, peers: frozenPeers } = validatePeers(peers);
  return floodImpl(originId, frozenPeers, identityTransform);
}

const identityTransform = <T>(xs: T): T => xs;

/**
 * Internal shared implementation used by `flood`, `pathVector`, and
 * `tellAndRead.outbound`. The `transform` rewrites the per-peer
 * outbound batch: return `msgs` unchanged to flood as-is, return a
 * subset to filter, return rewritten messages to change what the peer
 * receives, or return `[]` to skip the peer entirely.
 *
 * @internal
 */
export function floodImpl(
  originId: string,
  peers: readonly Peer[],
  transform: (msgs: Message[], peer: Peer) => Message[],
): ProtocolInterfaceNode {
  return {
    // ── receive ──────────────────────────────────────────────────────

    async receive(msgs: Message[]): Promise<ReceiveResult[]> {
      if (msgs.length === 0) return [];

      await Promise.all(peers.map(async (p) => {
        const outbound = transform(msgs, p);
        if (outbound.length === 0) return;
        await p.client.receive(outbound);
      }));

      // Success per *input* message — we fanned out to the peers the
      // transform selected. Transport-level failures throw and
      // propagate; wrap individual peers with a best-effort decorator
      // if you want rejection tolerance.
      return msgs.map(() => ({ accepted: true }));
    },

    // ── read ─────────────────────────────────────────────────────────

    async read<T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      if (uriList.length === 0) return [];

      let lastErr: string | undefined;
      for (const p of peers) {
        try {
          const results = await p.client.read<T>(uriList);
          if (results.some((r) => r.success)) return results;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }
      return uriList.map(() => ({
        success: false,
        error: lastErr ?? "no peer returned a match",
      } as ReadResult<T>));
    },

    // ── observe ──────────────────────────────────────────────────────

    async *observe<T = unknown>(
      pattern: string,
      signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      const queue: ReadResult<T>[] = [];
      let wake: (() => void) | null = null;

      const forwarders = peers.map(async (p) => {
        try {
          for await (const r of p.client.observe<T>(pattern, signal)) {
            queue.push(r);
            const w = wake;
            if (w) {
              wake = null;
              w();
            }
          }
        } catch {
          // Per-peer observe errors are swallowed — one broken peer
          // should not tear down the merged stream. The signal is still
          // the caller's mechanism to stop everything.
        }
      });

      const onAbort = () => {
        const w = wake;
        if (w) {
          wake = null;
          w();
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        while (true) {
          while (queue.length > 0) yield queue.shift()!;
          if (signal.aborted) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        await Promise.allSettled(forwarders);
      }
    },

    // ── status ───────────────────────────────────────────────────────

    async status(): Promise<StatusResult> {
      const settled = await Promise.allSettled(
        peers.map((p) => p.client.status()),
      );
      let healthy = 0;
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value.status === "healthy") healthy++;
      }
      const total = peers.length;
      return {
        status: healthy === total
          ? "healthy"
          : healthy > 0
          ? "degraded"
          : "unhealthy",
        message: `${healthy}/${total} peers healthy`,
        details: { originId, peerCount: total, healthyPeers: healthy },
      };
    },
  };
}

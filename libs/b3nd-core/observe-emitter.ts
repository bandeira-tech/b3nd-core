/**
 * @module
 * ObserveEmitter — the shared listener + async-iterator machinery used by
 * clients (SimpleClient, DataStoreClient) to expose `observe()`.
 *
 * Observe is a client concern. Clients orchestrate writes and deletes —
 * they know when state changes. Stores are mechanical and should not
 * carry observe responsibility.
 *
 * Events:
 *   - write  → `_emit(uri, data)`
 *   - delete → `_emit(uri, null)` (via `_emitDeletes([uri, ...])`)
 *
 * Each call to `observe(pattern, signal)` registers a persistent
 * per-iterator listener that survives yields — events emitted while the
 * consumer is processing a yielded value are buffered in a per-iterator
 * queue, not lost.
 */
import { matchPattern } from "./match-pattern.ts";
import type { ReadResult } from "./types.ts";

export type ObserveListener = (
  uri: string,
  data: unknown,
) => void;

/**
 * Base class providing a write/delete listener bus and an async iterator
 * for observing URI-pattern changes.
 *
 * Subclasses call `_emit(uri, data)` on successful writes and
 * `_emitDeletes(uris)` on successful deletes. `observe(pattern, signal)`
 * is a plug-and-play `ProtocolInterfaceNode.observe` implementation.
 */
export class ObserveEmitter {
  protected _listeners: Set<ObserveListener> = new Set<ObserveListener>();

  /**
   * Notify all listeners of a URI change.
   */
  protected _emit(
    uri: string,
    data: unknown,
  ): void {
    for (const listener of this._listeners) {
      try {
        listener(uri, data);
      } catch {
        // Listener errors must never break the emitter.
      }
    }
  }

  /** Notify all listeners that each URI was deleted (data = null). */
  protected _emitDeletes(uris: readonly string[]): void {
    for (const uri of uris) this._emit(uri, null);
  }

  /**
   * Async iterator yielding `ReadResult` for each URI change matching
   * the pattern. Runs until `signal` aborts.
   *
   * Deletes surface as `{ success: true, uri, record: { data: null } }`.
   *
   * The listener stays registered for the lifetime of the iteration;
   * events fired while the consumer is processing a yielded value are
   * buffered in a per-iterator queue so nothing is dropped across the
   * yield boundary.
   */
  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    const segments = pattern.split("/");
    const queue: ReadResult<T>[] = [];
    let wake: (() => void) | null = null;

    const listener: ObserveListener = (uri, data) => {
      if (matchPattern(segments, uri) !== null) {
        queue.push({
          success: true,
          uri,
          record: { data: data as T },
        });
        const w = wake;
        if (w) {
          wake = null;
          w();
        }
      }
    };

    const onAbort = () => {
      const w = wake;
      if (w) {
        wake = null;
        w();
      }
    };

    this._listeners.add(listener);
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        // Drain everything buffered so far.
        while (queue.length > 0) yield queue.shift()!;
        if (signal.aborted) return;
        // Nothing buffered — wait for an event or abort.
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this._listeners.delete(listener);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

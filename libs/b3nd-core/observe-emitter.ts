/**
 * @module
 * ObserveEmitter — the shared listener + async-iterator machinery used by
 * clients (SimpleClient, DataStoreClient) to expose `observe()`.
 *
 * Observe is INV-style notification: each successful write or delete
 * yields an `Output<string[]>` — `[meta, uris]` — where `meta` is a
 * synthetic address picked by the emitter and `uris` is the package of
 * uris that fired in this batch. The default emitter sends one uri
 * per package; backends with cheap batching can send several.
 *
 * `observe(urls, signal)` accepts the read-url grammar but only uses
 * each url's routing key (the uri portion) for pattern matching. The
 * query string is ignored at the framework level.
 */
import { matchPattern } from "./match-pattern.ts";
import type { Output } from "./types.ts";
import { routingKey } from "./url.ts";

/**
 * Synthetic address the emitter stamps on each observe package. The
 * framework reserves `b3nd://` for invented uris; backends with their
 * own observe machinery may use a different sentinel.
 */
const OBSERVE_URI = "b3nd://observe";

export type ObserveListener = (
  uri: string,
  data: unknown,
) => void;

/**
 * Base class providing a write/delete listener bus and an async iterator
 * for observing URI-pattern changes.
 *
 * Subclasses call `_emit(uri, data)` on successful writes and
 * `_emitDeletes(uris)` on successful deletes. The emitter ignores
 * `data` for INV-style notifications — observers receive only the
 * uri and read it themselves.
 */
export class ObserveEmitter {
  protected _listeners: Set<ObserveListener> = new Set<ObserveListener>();

  /**
   * Notify all listeners of a URI change. `data` is accepted for
   * compatibility with subclasses that may reuse the listener bus,
   * but it is not surfaced to observe iterators.
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

  /** Notify all listeners that each URI was deleted. */
  protected _emitDeletes(uris: readonly string[]): void {
    for (const uri of uris) this._emit(uri, null);
  }

  /**
   * Async iterator yielding `Output<string[]>` packages for each URI
   * change matching any of the input urls. Runs until `signal` aborts.
   *
   * Default emission packages one uri per yield; subclasses with cheap
   * batching can override to bundle.
   *
   * The listener stays registered for the lifetime of the iteration;
   * events fired while the consumer is processing a yielded value are
   * buffered in a per-iterator queue so nothing is dropped across the
   * yield boundary.
   */
  async *observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<Output<string[]>> {
    const patterns = urls.map((u) => routingKey(u).split("/"));
    const queue: Output<string[]>[] = [];
    let wake: (() => void) | null = null;

    const listener: ObserveListener = (uri, _data) => {
      const matched = patterns.some((segs) => matchPattern(segs, uri) !== null);
      if (matched) {
        queue.push([OBSERVE_URI, [uri]]);
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
        while (queue.length > 0) yield queue.shift()!;
        if (signal.aborted) return;
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

/**
 * @module
 * ObserveEmitter — the shared listener + async-iterator machinery
 * `ProtocolInterfaceNode` implementations use to expose `observe()`.
 *
 * Observe is INV-style notification: each successful write or delete
 * yields a `readonly string[]` — the batch of concrete uris that
 * fired. The default emitter sends one uri per yield; backends with
 * cheap batching can send several. A single change matching several
 * input patterns yields once (not once per matching pattern); callers
 * who need to know which of their patterns matched re-run the match
 * locally, which is cheap and keeps the stream minimal.
 *
 * `observe(locators, signal)` accepts locators as opaque strings and
 * matches them as segment-globs against emitted uris. The framework
 * imposes no grammar — locators are split on `/` and fed straight to
 * `matchPattern`. Any normalization (e.g. stripping request-time
 * directives before matching) is the executing client's responsibility.
 */
import { matchPattern } from "../match-pattern/match-pattern.ts";

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
   * Async iterator yielding `readonly string[]` batches of uris that
   * changed under any input pattern. Runs until `signal` aborts.
   *
   * Default emission yields a singleton batch per matching change;
   * subclasses with cheap batching can override to coalesce.
   *
   * The listener stays registered for the lifetime of the iteration;
   * events fired while the consumer is processing a yielded value are
   * buffered in a per-iterator queue so nothing is dropped across the
   * yield boundary.
   */
  async *observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<readonly string[]> {
    const patterns = urls.map((u) => u.split("/"));
    const queue: (readonly string[])[] = [];
    let wake: (() => void) | null = null;

    const listener: ObserveListener = (uri, _data) => {
      for (const segs of patterns) {
        if (matchPattern(segs, uri) !== null) {
          queue.push([uri]);
          const w = wake;
          if (w) {
            wake = null;
            w();
          }
          return;
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

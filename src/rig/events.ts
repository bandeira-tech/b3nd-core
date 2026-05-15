/**
 * @module
 * Typed event emitter for the Rig.
 *
 * Events are async, fire-and-forget — they run AFTER the operation
 * completes (after post-hooks). They never block the caller.
 * Handler errors are caught and logged, never propagated.
 *
 * On cleanup, pending event promises are returned to the caller
 * so they can choose to await them or let them go.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

// ── Types ──

/** All possible rig event names. */
export type RigEventName =
  | "send:success"
  | "send:error"
  | "receive:success"
  | "receive:error"
  | "read:success"
  | "read:error"
  | "*:success"
  | "*:error";

/** Payload delivered to event handlers. */
export interface RigEvent {
  /** The operation that triggered this event. */
  op: string;
  /** The URI involved, if any. */
  uri?: string;
  /** The data involved (e.g., receive payload, send envelope). */
  data?: unknown;
  /** The operation result (on success). */
  result?: unknown;
  /** The error (on error). */
  error?: unknown;
  /** Timestamp when the event was emitted. */
  ts: number;
}

/** Event handler function. */
export type EventHandler = (event: RigEvent) => void | Promise<void>;

// ── Emitter ──

/**
 * Typed event emitter for Rig operations.
 *
 * - Handlers fire asynchronously (via microtask)
 * - Handler errors are caught and logged to console.warn
 * - Wildcard events (`*:success`, `*:error`) fire for all operations
 * - `pending()` returns in-flight handler promises for drain-on-cleanup
 */
export class RigEventEmitter {
  private handlers = new Map<RigEventName, Set<EventHandler>>();
  private inflight: Promise<void>[] = [];

  /** Register a handler. Returns an unsubscribe function. */
  on(event: RigEventName, handler: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Remove a specific handler. */
  off(event: RigEventName, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** Return handler counts per event name. */
  counts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, set] of this.handlers) {
      if (set.size > 0) result[name] = set.size;
    }
    return result;
  }

  /**
   * Fire an event. Handlers run asynchronously and never block.
   * Errors in handlers are caught and logged to console.warn.
   * Promises are tracked so `pending()` can return them.
   */
  emit(event: RigEventName, payload: RigEvent): void {
    const specific = this.handlers.get(event);
    // Determine wildcard: "send:success" → "*:success"
    const suffix = event.endsWith(":success") ? "*:success" : "*:error";
    const wildcard = this.handlers.get(suffix as RigEventName);

    const all = [
      ...(specific ? specific : []),
      ...(wildcard && event !== suffix ? wildcard : []),
    ];

    for (const handler of all) {
      const p = Promise.resolve().then(() => handler(payload)).catch((err) => {
        console.warn(`[rig] event handler error on "${event}":`, err);
      });
      this.inflight.push(p);
    }

    // Prune settled promises to prevent unbounded growth
    if (this.inflight.length > 100) {
      this.inflight = this.inflight.filter((p) => {
        let settled = false;
        p.then(() => settled = true, () => settled = true);
        return !settled;
      });
    }
  }

  /**
   * Return all in-flight event handler promises and clear the queue.
   *
   * The caller decides what to do with them:
   * - `await Promise.allSettled(pending)` to drain before exit
   * - Ignore them if you don't care about completion
   */
  pending(): Promise<void>[] {
    const result = this.inflight;
    this.inflight = [];
    return result;
  }
}

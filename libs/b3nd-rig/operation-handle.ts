/**
 * @module
 * Operation handles — the return value of `rig.receive()` / `rig.send()`.
 *
 * An OperationHandle is BOTH:
 *   - a `Promise<ReceiveResult[]>` (the pipeline-stage acknowledgment;
 *     resolves once `process` + `handle` finish for every input tuple),
 *   - and a scoped event emitter that fires per-stage events for THIS
 *     operation as it progresses (`process:done`, `handle:emit`,
 *     `route:success`, `route:error`, `settled`).
 *
 * Why both shapes:
 *   - Awaitable so existing callers (`await rig.receive(outs)`) and
 *     `ProtocolInterfaceNode.receive` consumers see no contract change.
 *   - Observable so callers who care about per-stage detail or per-route
 *     dispatch outcomes can subscribe inline, without correlation IDs
 *     or filtering global rig events.
 *
 * Single paper-trail: the events are the source of truth. The result
 * the await resolves to (`ReceiveResult[]`) is the small pipeline-level
 * ack; everything richer flows through events.
 *
 * Dispatch is async by design: `await op` resolves once the pipeline
 * decides what to dispatch, but the broadcast itself runs in the
 * background. Per-route events fire after the await has returned.
 * Callers that need full settlement await `op.settled` (a Promise that
 * resolves on the `settled` event).
 */

import type {
  B3ndError,
  Output,
  ProgramResult,
  ReceiveResult,
} from "../b3nd-core/types.ts";

// ── Event payloads ───────────────────────────────────────────────────

/** Emitted once `process()` produces a classification for one input tuple. */
export interface ProcessDoneEvent {
  /** The input tuple being classified. */
  input: Output;
  /** The classification produced by `process()`. */
  result: ProgramResult;
}

/** Emitted when `process()` throws or a program returns an error code. */
export interface ProcessErrorEvent {
  /** The input tuple whose classification failed. */
  input: Output;
  /** Error message. */
  error: string;
  /** Structured error info, when available. */
  errorDetail?: B3ndError;
  /** The original thrown value (if `process()` threw). */
  cause?: unknown;
}

/** Emitted once `handle()` returns its emissions for one classified tuple. */
export interface HandleEmitEvent {
  /** The input tuple that was handled. */
  input: Output;
  /** The classification that was passed to `handle()`. */
  classification: ProgramResult;
  /** What the handler returned — the tuples to dispatch. */
  emissions: Output[];
}

/** Emitted when `handle()` throws while processing one classified tuple. */
export interface HandleErrorEvent {
  /** The input tuple that was handled. */
  input: Output;
  /** The classification that was passed to `handle()`. */
  classification: ProgramResult;
  /** Error message. */
  error: string;
  /** The original thrown value. */
  cause?: unknown;
}

/** Emitted when a registered reaction throws while running. */
export interface ReactionErrorEvent {
  /** The emission whose URI matched the reaction's pattern. */
  emission: Output;
  /** The reaction's URI pattern. */
  pattern: string;
  /** Error message. */
  error: string;
  /** The original thrown value. */
  cause?: unknown;
}

/** Emitted when a single connection accepts a single emission. */
export interface RouteSuccessEvent {
  /** The tuple that was dispatched. */
  emission: Output;
  /** Stable ID of the connection that accepted. */
  connectionId: string;
}

/** Emitted when a single connection rejects a single emission. */
export interface RouteErrorEvent {
  /** The tuple that was dispatched. */
  emission: Output;
  /** Stable ID of the connection that rejected. */
  connectionId: string;
  /** Error message. */
  error?: string;
  /** Structured error info, when available. */
  errorDetail?: B3ndError;
}

/** Emitted once after the operation's last route has settled. */
export interface SettledEvent {
  /** The pipeline-stage results returned by the await. */
  results: ReceiveResult[];
}

/** Names of events the OperationHandle fires. */
export type OperationEventName =
  | "process:done"
  | "process:error"
  | "handle:emit"
  | "handle:error"
  | "route:success"
  | "route:error"
  | "reaction:error"
  | "settled";

/** Map from event name to payload type. */
export interface OperationEventMap {
  "process:done": ProcessDoneEvent;
  "process:error": ProcessErrorEvent;
  "handle:emit": HandleEmitEvent;
  "handle:error": HandleErrorEvent;
  "route:success": RouteSuccessEvent;
  "route:error": RouteErrorEvent;
  "reaction:error": ReactionErrorEvent;
  "settled": SettledEvent;
}

/**
 * Generic event handler. Return value is ignored, but accepting any
 * type lets handler bodies use expression-style arrow functions —
 * `op.on("route:success", e => log.push(e.emission[0]))` — without
 * TS yelling about the return type.
 */
export type OperationEventHandler<E extends OperationEventName> = (
  event: OperationEventMap[E],
) => unknown;

// ── OperationHandle ──────────────────────────────────────────────────

/**
 * Promise + scoped event emitter for one rig.receive / rig.send call.
 *
 * Awaiting the handle resolves to the pipeline-stage `ReceiveResult[]`
 * (one per input tuple). Subscribing to the handle observes per-stage
 * events scoped to this operation only.
 *
 * Construction is internal — the Rig builds the handle, exposes it to
 * the caller, and drives its lifecycle via the helper methods on the
 * implementation class.
 */
export interface OperationHandle extends PromiseLike<ReceiveResult[]> {
  /**
   * Subscribe to an event scoped to this operation.
   * Returns an unsubscribe function.
   */
  on<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): () => void;

  /** Remove a previously-registered handler. */
  off<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): void;

  /**
   * Convenience Promise that resolves once the `settled` event fires —
   * i.e., every dispatched route has settled. Useful for callers who
   * need read-after-write semantics across replicas:
   *
   * ```ts
   * const op = rig.send([out]);
   * await op;            // pipeline ack
   * await op.settled;    // wait for all routes
   * const data = await rig.read(out[0]);
   * ```
   *
   * The same outcome is observable via `op.on("settled", …)`. This
   * accessor exists for the common await-then-read pattern.
   */
  readonly settled: Promise<SettledEvent>;
}

// ── Implementation ───────────────────────────────────────────────────

interface ListenerEntry<E extends OperationEventName = OperationEventName> {
  event: E;
  handler: OperationEventHandler<E>;
}

/**
 * Internal implementation. The Rig drives this via the `_pipelineDone`
 * and `_emit` methods; callers see the `OperationHandle` interface.
 */
export class OperationHandleImpl implements OperationHandle {
  private _listeners: ListenerEntry[] = [];
  private _pipelinePromise: Promise<ReceiveResult[]>;
  private _resolvePipeline!: (results: ReceiveResult[]) => void;
  private _rejectPipeline!: (err: unknown) => void;
  private _settledPromise: Promise<SettledEvent>;
  private _resolveSettled!: (event: SettledEvent) => void;

  constructor() {
    this._pipelinePromise = new Promise<ReceiveResult[]>((resolve, reject) => {
      this._resolvePipeline = resolve;
      this._rejectPipeline = reject;
    });
    this._settledPromise = new Promise<SettledEvent>((resolve) => {
      this._resolveSettled = resolve;
    });
  }

  // ── Internal driver methods (called by the Rig) ──

  /** Resolve the pipeline-stage promise. */
  _pipelineDone(results: ReceiveResult[]): void {
    this._resolvePipeline(results);
  }

  /** Reject the pipeline-stage promise (a hook threw, etc.). */
  _pipelineError(err: unknown): void {
    this._rejectPipeline(err);
  }

  /**
   * Emit a scoped event. Handlers run fire-and-forget; errors caught
   * and logged so a misbehaving handler can't break the operation.
   * The `settled` event also resolves the `settled` promise.
   */
  _emit<E extends OperationEventName>(
    event: E,
    payload: OperationEventMap[E],
  ): void {
    // Schedule handler microtasks BEFORE resolving the settled promise.
    // Microtask order is FIFO, so handlers' microtasks run before any
    // `await op.settled` continuation. This matters for tests/callers
    // that subscribe to `settled` and inspect state right after
    // awaiting `op.settled`.
    for (const entry of this._listeners) {
      if (entry.event !== event) continue;
      Promise.resolve()
        .then(() => (entry.handler as OperationEventHandler<E>)(payload))
        .catch((err) => {
          console.warn(`[rig] operation listener error on "${event}":`, err);
        });
    }
    if (event === "settled") {
      this._resolveSettled(payload as SettledEvent);
    }
  }

  // ── Public OperationHandle interface ──

  on<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): () => void {
    const entry: ListenerEntry = {
      event,
      handler: handler as OperationEventHandler<OperationEventName>,
    };
    this._listeners.push(entry);
    return () => this.off(event, handler);
  }

  off<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): void {
    const idx = this._listeners.findIndex(
      (e) => e.event === event && e.handler === handler,
    );
    if (idx >= 0) this._listeners.splice(idx, 1);
  }

  get settled(): Promise<SettledEvent> {
    return this._settledPromise;
  }

  // PromiseLike implementation — delegates to the pipeline promise.
  then<TResult1 = ReceiveResult[], TResult2 = never>(
    onfulfilled?:
      | ((value: ReceiveResult[]) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): PromiseLike<TResult1 | TResult2> {
    return this._pipelinePromise.then(onfulfilled, onrejected);
  }
}

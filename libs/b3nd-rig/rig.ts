/**
 * @module
 * Rig — the universal harness for b3nd.
 *
 * Single object that wires up backends, identity, and serving.
 * Two core actions: send (outward to the network) and receive
 * (inward from external sources). Everything else is observation.
 *
 * Supports per-operation client routing, synchronous hooks
 * (pre/post), async events, and URI-pattern reactions.
 */

import type {
  CodeHandler,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import type {
  RigConfig,
  RigInfo,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";
import type {
  ErrorHookCtx,
  ReadCtx,
  ReceiveCtx,
  RigHooks,
  SendCtx,
} from "./hooks.ts";
import { resolveHooks, runAfter, runBefore, runOnError } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import { RigEventEmitter } from "./events.ts";
import type { ReactionHandler } from "./reactions.ts";
import { ReactionRegistry } from "./reactions.ts";
import type { Connection } from "./connection.ts";
import type { OperationHandle } from "./operation-handle.ts";
import { OperationHandleImpl } from "./operation-handle.ts";

/**
 * Rig — pure orchestration for b3nd.
 *
 * The rig is identity-free — it routes, validates, and dispatches.
 * For authenticated operations, use `Identity.sign()` + `message()` +
 * `rig.send()` directly.
 *
 * @example Unsigned operations
 * ```typescript
 * const local = connection(client, ["*"]);
 * const rig = new Rig({
 *   routes: { receive: [local], read: [local], observe: [local] },
 * });
 * const results = await rig.receive([["mutable://open/app/x", data]]);
 * ```
 *
 * @example Authenticated send
 * ```typescript
 * // With messageDataHandler registered, the rig decomposes the
 * // envelope into outputs + null-payload deletions for inputs.
 * const id = await Identity.fromSeed("my-secret");
 * const auth = [await id.sign({ inputs: [], outputs })];
 * const envelope = await message({ auth, inputs: [], outputs });
 * await rig.send([envelope]);
 * ```
 *
 * @example With programs, hooks, events, and reactions
 * ```typescript
 * const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);
 * const rig = new Rig({
 *   routes: { receive: [local], read: [local], observe: [local] },
 *   programs,
 *   handlers,
 *   hooks: {
 *     beforeReceive: (ctx) => { rateLimit(ctx.uri); },
 *     afterRead: (ctx, result) => { audit(ctx.uri, result); },
 *   },
 *   on: {
 *     "send:success": [audit],
 *   },
 *   reactions: {
 *     "mutable://app/users/:id": async (out, _read, { id }) => {
 *       return [[`notify://email/${id}`, { kind: "user-updated" }]];
 *     },
 *   },
 * });
 * ```
 */
export class Rig {
  // ── Internal state ──
  private readonly _receiveRoutes: readonly Connection[];
  private readonly _readRoutes: readonly Connection[];
  private readonly _observeRoutes: readonly Connection[];
  private readonly _dispatch: ProtocolInterfaceNode;
  private readonly _programs: Record<string, Program> | null;
  private readonly _handlers: Record<string, CodeHandler> | null;
  private readonly _hooks: RigHooks;
  private readonly _events: RigEventEmitter;
  private readonly _reactors: ReactionRegistry;

  constructor(config: RigConfig) {
    const routes = config.routes;
    const receive = routes?.receive ?? [];
    const read = routes?.read ?? [];
    const observe = routes?.observe ?? [];

    if (
      receive.length === 0 && read.length === 0 && observe.length === 0
    ) {
      throw new Error(
        "Rig: `routes` must declare at least one of `receive`, `read`, or `observe`.",
      );
    }

    this._receiveRoutes = Object.freeze([...receive]);
    this._readRoutes = Object.freeze([...read]);
    this._observeRoutes = Object.freeze([...observe]);
    this._dispatch = createRouteDispatch({
      receive: this._receiveRoutes,
      read: this._readRoutes,
      observe: this._observeRoutes,
    });
    this._programs = config.programs ?? null;
    this._handlers = config.handlers ?? null;
    this._hooks = resolveHooks(config.hooks);

    // Build event emitter
    this._events = new RigEventEmitter();
    if (config.on) {
      for (const [name, handlers] of Object.entries(config.on)) {
        if (handlers) {
          for (const handler of handlers) {
            this._events.on(name as RigEventName, handler);
          }
        }
      }
    }

    // Build react registry
    this._reactors = new ReactionRegistry();
    if (config.reactions) {
      for (const [pattern, handler] of Object.entries(config.reactions)) {
        this._reactors.add(pattern, handler);
      }
    }
  }

  /**
   * Raw composite client — bypasses hooks, events, and react.
   *
   * Prefer passing the Rig itself (it satisfies `ProtocolInterfaceNode`).
   * This getter exists for third-party code that requires a plain object.
   */
  get client(): ProtocolInterfaceNode {
    const d = this._dispatch;
    return {
      receive: (msgs) => d.receive(msgs),
      read: (uris) => d.read(uris),
      observe: (pattern, signal) => d.observe(pattern, signal),
      status: () => d.status(),
    };
  }

  // ── Core actions ──

  /**
   * Send tuples — the host application acting as the origin.
   *
   * Returns an `OperationHandle` that:
   *   - Awaits to `ReceiveResult[]` once the pipeline (process →
   *     handle) finishes. Pipeline-stage ack only — broadcast may
   *     still be in flight.
   *   - Fires per-stage events (`process:done`, `handle:emit`,
   *     `route:success`/`route:error`, `settled`) scoped to this call.
   *
   * Dispatch to connections runs in the background; per-route outcomes
   * arrive as events. Wait for `op.settled` for read-after-write
   * guarantees across replicas.
   *
   * Use this when the host is the origin of the content (a button
   * click, a worker emitting state, a signed envelope from
   * `Identity.sign()` + `message()`). Use `receive()` when content arrives from
   * elsewhere (a peer, a webhook, an upstream sync).
   *
   * @example
   * ```typescript
   * const op = rig.send([["mutable://app/state", { value: 42 }]]);
   * op.on("route:error", (e) => retry(e.emission));
   * const [result] = await op;             // pipeline ack
   * await op.settled;                       // routes fully settled
   * ```
   */
  send(outs: Output[]): OperationHandle {
    return this._pipeline(outs, "send");
  }

  /**
   * Receive tuples — the host application accepting state from elsewhere.
   *
   * Same shape as `send()` but fires `beforeReceive`/`afterReceive`
   * hooks and `receive:*` global events. Returns an `OperationHandle`
   * with the same scoped per-stage events.
   *
   * @example
   * ```typescript
   * const [result] = await rig.receive([
   *   ["mutable://open/external", { source: "webhook" }],
   * ]);
   * ```
   */
  receive(outs: Output[]): OperationHandle {
    return this._pipeline(outs, "receive");
  }

  /**
   * Same as `receive()` but throws if any input tuple is rejected at
   * the pipeline stage. Convenience for callers that don't want to
   * inspect `accepted`.
   */
  async receiveOrThrow(outs: Output[]): Promise<ReceiveResult[]> {
    const results = await this.receive(outs);
    const failed = results.find((r) => !r.accepted);
    if (failed) throw new Error(failed.error ?? "rig.receive: rejected");
    return results;
  }

  /** Same as `send()` but throws on any pipeline-stage rejection. */
  async sendOrThrow(outs: Output[]): Promise<ReceiveResult[]> {
    const results = await this.send(outs);
    const failed = results.find((r) => !r.accepted);
    if (failed) throw new Error(failed.error ?? "rig.send: rejected");
    return results;
  }

  /**
   * Classify a batch of tuples — runs registered programs.
   *
   * For each output, finds the program with the longest matching URI
   * prefix and invokes it. Tuples whose URI matches no registered
   * program get a default `{ code: "ok" }` classification (so the
   * default-dispatch path persists them as-is).
   *
   * Pure: returns one `ProgramResult` per input tuple. No side effects.
   */
  async process(outs: Output[]): Promise<ProgramResult[]> {
    const readFn = this._readFn();
    const results: ProgramResult[] = [];
    for (const out of outs) {
      const program = this._findProgram(out[0]);
      results.push(
        program ? await program(out, undefined, readFn) : { code: "ok" },
      );
    }
    return results;
  }

  /**
   * Run the handler for a classified tuple — returns the emissions.
   *
   * If no handler is registered for the result's code, the input tuple
   * is returned as-is (default-persist). Handlers themselves return the
   * `Output[]` they want the Rig to dispatch; this method surfaces that
   * return for callers that want to compose the pipeline manually.
   *
   * Pure: no dispatch happens here. Use `send()` / `receive()` for the
   * full pipeline including dispatch and reactions.
   */
  async handle(out: Output, result: ProgramResult): Promise<Output[]> {
    const handler = this._handlers?.[result.code];
    if (!handler) return [out];
    return await handler(out, result, this._readFn());
  }

  /**
   * The pipeline body shared by `send()` and `receive()`.
   *
   * Returns an `OperationHandle` synchronously. The pipeline runs
   * asynchronously inside; awaiting the handle resolves to the
   * pipeline-stage `ReceiveResult[]` (process + handle outcome only).
   * Per-route dispatch runs in the background; route outcomes arrive
   * as events on the handle. `op.settled` resolves once every route
   * has answered.
   *
   * Reactions fire after each emission's routes settle — once per
   * emission, only if at least one route accepted. Their emissions
   * spawn a fresh `rig.send(...)` operation, independent of this one.
   */
  private _pipeline(
    outs: Output[],
    direction: "send" | "receive",
  ): OperationHandle {
    const handle = new OperationHandleImpl();

    // Run the pipeline asynchronously. The handle is returned now;
    // pipeline-ack and route events fire as work completes.
    void this._runPipeline(outs, direction, handle);

    return handle;
  }

  /** Internal: pipeline body driven against an OperationHandleImpl. */
  private async _runPipeline(
    outs: Output[],
    direction: "send" | "receive",
    handle: OperationHandleImpl,
  ): Promise<void> {
    try {
      // Before-hook per tuple — throw to reject.
      const finalOuts: Output[] = [];
      for (const out of outs) {
        const [uri, payload] = out;
        if (direction === "receive") {
          const ctx: ReceiveCtx = { uri, data: payload };
          const recvCtx = await runBefore(this._hooks.beforeReceive, ctx);
          finalOuts.push([recvCtx.uri, recvCtx.data] as Output);
        } else {
          const ctx: SendCtx = { message: out };
          const sendCtx = await runBefore(this._hooks.beforeSend, ctx);
          finalOuts.push(sendCtx.message as Output);
        }
      }

      const results: ReceiveResult[] = [];
      const broadcastPromises: Promise<void>[] = [];

      for (let i = 0; i < finalOuts.length; i++) {
        const out = finalOuts[i];
        const [uri, payload] = out;

        // ── process — classify the tuple, isolated so a thrown
        // program doesn't fail the whole batch. ──
        let programResult: ProgramResult;
        try {
          programResult = await this._processOne(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          handle._emit("process:error", {
            input: out,
            error: message,
            cause: err,
          });
          await runOnError(this._hooks.onError, {
            phase: "process",
            input: out,
            error: message,
            cause: err,
          });
          const result: ReceiveResult = { accepted: false, error: message };
          results.push(result);
          this._events.emit(`${direction}:error`, {
            op: direction,
            uri,
            error: message,
            ts: Date.now(),
          });
          await this._runAfterFor(direction, out, payload, result);
          continue;
        }

        handle._emit("process:done", { input: out, result: programResult });

        // Structural pre-check: if no connection accepts this URI for
        // receive, the rig has no topology to dispatch through.
        const hasRoute = this._receiveRoutes.some((c) => c.accepts(uri));
        if (!hasRoute) {
          const error = `No connection accepts receive for ${uri}`;
          handle._emit("process:error", { input: out, error });
          await runOnError(this._hooks.onError, {
            phase: "process",
            input: out,
            error,
          });
          const result: ReceiveResult = { accepted: false, error };
          results.push(result);
          this._events.emit(`${direction}:error`, {
            op: direction,
            uri,
            error,
            ts: Date.now(),
          });
          await this._runAfterFor(direction, out, payload, result);
          continue;
        }

        if (programResult.error) {
          const error = programResult.error;
          handle._emit("process:error", { input: out, error });
          await runOnError(this._hooks.onError, {
            phase: "process",
            input: out,
            error,
          });
          const result: ReceiveResult = { accepted: false, error };
          results.push(result);
          this._events.emit(`${direction}:error`, {
            op: direction,
            uri,
            error,
            ts: Date.now(),
          });
          await this._runAfterFor(direction, out, payload, result);
          continue;
        }

        // ── handle — run the registered handler. ──
        let emissions: Output[];
        try {
          emissions = await this.handle(out, programResult);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          handle._emit("handle:error", {
            input: out,
            classification: programResult,
            error: message,
            cause: err,
          });
          await runOnError(this._hooks.onError, {
            phase: "handle",
            input: out,
            classification: programResult,
            error: message,
            cause: err,
          });
          const result: ReceiveResult = { accepted: false, error: message };
          results.push(result);
          this._events.emit(`${direction}:error`, {
            op: direction,
            uri,
            error: message,
            ts: Date.now(),
          });
          await this._runAfterFor(direction, out, payload, result);
          continue;
        }
        handle._emit("handle:emit", {
          input: out,
          classification: programResult,
          emissions,
        });

        // Pipeline accepted — record success now, dispatch in background.
        const result: ReceiveResult = { accepted: true };
        results.push(result);
        this._events.emit(`${direction}:success`, {
          op: direction,
          uri,
          data: payload,
          result,
          ts: Date.now(),
        });

        // Schedule per-route dispatch — fire-and-forget for the pipeline.
        broadcastPromises.push(
          this._dispatchRouteAware(emissions, handle, out),
        );

        await this._runAfterFor(direction, out, payload, result);
      }

      // Resolve pipeline-ack. Caller's `await op` returns now.
      handle._pipelineDone(results);

      // Wait for all routes to settle (and their reactions to fire),
      // then emit the `settled` event.
      await Promise.all(broadcastPromises);
      handle._emit("settled", { results });
    } catch (err) {
      handle._pipelineError(err);
    }
  }

  /**
   * Run process for a single output. Isolated so a thrown program
   * doesn't fail the whole batch.
   */
  private async _processOne(out: Output): Promise<ProgramResult> {
    const program = this._findProgram(out[0]);
    if (!program) return { code: "ok" };
    return await program(out, undefined, this._readFn());
  }

  /** Run the direction-appropriate after-hook with the standard payload. */
  private async _runAfterFor(
    direction: "send" | "receive",
    out: Output,
    payload: unknown,
    result: ReceiveResult,
  ): Promise<void> {
    if (direction === "receive") {
      await runAfter(
        this._hooks.afterReceive,
        { uri: out[0], data: payload },
        result,
      );
    } else {
      await runAfter(this._hooks.afterSend, { message: out }, result);
    }
  }

  /**
   * Per-emission, per-connection dispatch with route events.
   *
   * For each emission: find every connection in `routes.receive` that
   * accepts the URI, dispatch the emission to each independently, emit
   * `route:success` / `route:error` per (emission, connection). Once
   * all routes for an emission settle, fire reactions if any route
   * accepted. Reactions' returned tuples spawn a fresh `rig.send`
   * operation (independent of this one).
   *
   * `input` is the original tuple that drove this dispatch — passed
   * through so the `onError` hook can correlate route failures back
   * to the input that triggered them.
   */
  private async _dispatchRouteAware(
    emissions: Output[],
    handle: OperationHandleImpl,
    input: Output,
  ): Promise<void> {
    if (emissions.length === 0) return;
    const reactionPromises: Promise<void>[] = [];

    for (const emission of emissions) {
      const [uri] = emission;
      const matching = this._receiveRoutes.filter((c) => c.accepts(uri));

      if (matching.length === 0) {
        const error = `No connection accepts receive for ${uri}`;
        handle._emit("route:error", { emission, connectionId: "", error });
        await runOnError(this._hooks.onError, {
          phase: "route",
          input,
          emission,
          connectionId: "",
          error,
        });
        continue;
      }

      const perConnection: PromiseLike<boolean>[] = matching.map((conn) =>
        conn.client.receive([emission]).then(
          async (results) => {
            const r = results[0];
            if (r.accepted) {
              handle._emit("route:success", {
                emission,
                connectionId: conn.id,
              });
              return true;
            }
            handle._emit("route:error", {
              emission,
              connectionId: conn.id,
              error: r.error,
              errorDetail: r.errorDetail,
            });
            await runOnError(this._hooks.onError, {
              phase: "route",
              input,
              emission,
              connectionId: conn.id,
              error: r.error ?? "route rejected",
              errorDetail: r.errorDetail,
            });
            return false;
          },
          async (err) => {
            const message = err instanceof Error ? err.message : String(err);
            handle._emit("route:error", {
              emission,
              connectionId: conn.id,
              error: message,
            });
            await runOnError(this._hooks.onError, {
              phase: "route",
              input,
              emission,
              connectionId: conn.id,
              error: message,
              cause: err,
            });
            return false;
          },
        )
      );

      // Once all routes for this emission settle, fire reactions
      // (only if at least one route accepted).
      reactionPromises.push(
        Promise.all(perConnection).then((flags) =>
          this._fireReactionsForEmission(
            emission,
            flags.some((a) => a),
            handle,
            input,
          )
        ),
      );
    }

    await Promise.all(reactionPromises);
  }

  /**
   * Fire reactions for a successfully-dispatched emission. Reaction
   * returns are dispatched through a fresh `rig.send(...)` — that
   * spawned operation has its own OperationHandle and is unrelated
   * to the one that triggered it. Loops are usage error.
   */
  private async _fireReactionsForEmission(
    emission: Output,
    anyAccepted: boolean,
    handle: OperationHandleImpl,
    input: Output,
  ): Promise<void> {
    if (!anyAccepted || this._reactors.size === 0) return;
    const readFn = this._readFn();
    const matches = this._reactors.matches(emission[0]);
    if (matches.length === 0) return;

    const collected: Output[] = [];
    for (const { handler, params, pattern } of matches) {
      try {
        const emitted = await handler(emission, readFn, params);
        collected.push(...emitted);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        handle._emit("reaction:error", {
          emission,
          pattern,
          error: message,
          cause: err,
        });
        await runOnError(this._hooks.onError, {
          phase: "reaction",
          input,
          emission,
          pattern,
          error: message,
          cause: err,
        });
      }
    }

    if (collected.length > 0) {
      // Spawn a fresh send operation — fire-and-forget at this level.
      // The spawned op has its own handle for any caller that wants it.
      const spawn = this.send(collected);
      // Swallow rejections: reactions are observers, not blockers.
      Promise.resolve(spawn).catch((err) => {
        console.warn("[rig] reaction-emitted send error:", err);
      });
    }
  }

  /** Internal read helper bound to the dispatch read interface. */
  private _readFn(): <T = unknown>(u: string) => Promise<ReadResult<T>> {
    return async <T = unknown>(u: string) => {
      const results = await this._dispatch.read<T>(u);
      return results[0] ??
        { success: false, error: "No results" } as ReadResult<T>;
    };
  }

  /**
   * Find the program with the longest matching URI prefix.
   */
  private _findProgram(uri: string): Program | null {
    if (!this._programs) return null;
    let bestMatch: string | null = null;
    for (const prefix of Object.keys(this._programs)) {
      if (uri === prefix || uri.startsWith(prefix + "/")) {
        if (!bestMatch || prefix.length > bestMatch.length) {
          bestMatch = prefix;
        }
      }
    }
    return bestMatch ? this._programs[bestMatch] : null;
  }

  // ── Observation ──

  /**
   * Read data from one or more URIs.
   *
   * - Single URI: returns array with one result
   * - Multiple URIs: returns array with one result per URI
   * - Trailing slash: lists all items under path
   */
  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];

    // Before-hook on each URI
    const finalUris: string[] = [];
    for (const uri of uriList) {
      const ctx: ReadCtx = { uri };
      const readCtx = await runBefore(this._hooks.beforeRead, ctx);
      finalUris.push(readCtx.uri);
    }

    // Execute
    let results: ReadResult<T>[];
    try {
      results = await this._dispatch.read<T>(finalUris);
    } catch (err) {
      for (const uri of finalUris) {
        this._events.emit("read:error", {
          op: "read",
          uri,
          error: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      }
      throw err;
    }

    // After-hook + events per result
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const requestUri = finalUris[Math.min(i, finalUris.length - 1)];
      const uri = result.uri ?? requestUri;
      await runAfter(this._hooks.afterRead, { uri }, result);

      if (result.success) {
        this._events.emit("read:success", {
          op: "read",
          uri,
          result,
          ts: Date.now(),
        });
      } else {
        this._events.emit("read:error", {
          op: "read",
          uri,
          error: result.error,
          ts: Date.now(),
        });
      }
    }

    return results;
  }

  /**
   * Read just the data from a single URI, returning `null` if not found.
   */
  async readData<T = unknown>(uri: string): Promise<T | null> {
    const results = await this.read<T>(uri);
    const result = results[0];
    return result?.success && result.record ? result.record.data : null;
  }

  /**
   * Read data from a single URI, throwing if not found.
   */
  async readOrThrow<T = unknown>(uri: string): Promise<T> {
    const results = await this.read<T>(uri);
    const result = results[0];
    if (!result?.success || !result.record) {
      throw new Error(
        `Rig.readOrThrow: no data at ${uri}${
          result?.error ? ` (${result.error})` : ""
        }`,
      );
    }
    return result.record.data;
  }

  /**
   * Check if data exists at a URI.
   */
  async exists(uri: string): Promise<boolean> {
    const results = await this.read(uri);
    return results[0]?.success ?? false;
  }

  /**
   * Count items under a URI prefix.
   * Uses trailing-slash read to list items.
   */
  async count(uri: string): Promise<number> {
    const prefix = uri.endsWith("/") ? uri : `${uri}/`;
    const results = await this.read(prefix);
    return results.filter((r) => r.success).length;
  }

  /**
   * List URIs under a prefix — convenience for read with trailing slash.
   * Returns URI strings extracted from successful results.
   */
  private async listData(prefix: string): Promise<string[]> {
    const listUri = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const results = await this.read(listUri);
    return results
      .filter((r) => r.success)
      .map((r) => r.uri ?? "")
      .filter(Boolean);
  }

  // ── Observe (client-backed streaming) ──

  /**
   * Observe changes matching a URI pattern.
   *
   * Routes to the first connection that accepts `observe` for the pattern,
   * then delegates to the client's native transport (SSE, internal events, etc).
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   * for await (const result of rig.observe("mutable://data/market/*", abort.signal)) {
   *   console.log(result.uri, result.record?.data);
   * }
   * ```
   */
  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Strip :param and * segments to get the matchable prefix
    const segments = pattern.split("/");
    const matchUri = segments
      .filter((s) => !s.startsWith(":") && s !== "*")
      .join("/");

    // Find the first observe-route that accepts this prefix
    for (const conn of this._observeRoutes) {
      if (conn.accepts(matchUri)) {
        yield* conn.client.observe<T>(pattern, signal);
        return;
      }
    }
    // No observe route accepts — empty stream
  }

  // ── Inspection ──

  /**
   * Get a snapshot of this rig's current state.
   *
   * Pure local inspection, no network calls.
   *
   * @example
   * ```typescript
   * const info = rig.info();
   * console.log(info.behavior.hooks);
   * console.log(info.behavior.reactors);
   * ```
   */
  info(): RigInfo {
    const hooks: string[] = [];
    const h = this._hooks;
    if (h.beforeSend) hooks.push("beforeSend");
    if (h.afterSend) hooks.push("afterSend");
    if (h.beforeReceive) hooks.push("beforeReceive");
    if (h.afterReceive) hooks.push("afterReceive");
    if (h.beforeRead) hooks.push("beforeRead");
    if (h.afterRead) hooks.push("afterRead");

    return {
      behavior: {
        hooks,
        events: this._events.counts(),
        reactors: this._reactors.size,
      },
    };
  }

  // ── Infrastructure ──

  /**
   * Status — health + schema.
   * Aggregates client status across all connections.
   */
  async status(): Promise<StatusResult> {
    return await this._dispatch.status();
  }

  /**
   * Return any in-flight event handler promises and clear the queue.
   */
  drain(): Promise<void>[] {
    return this._events.pending();
  }

  // ── Runtime API: events, react ──
  // Hooks are immutable after init — see createHookChains().

  /**
   * Register an event handler at runtime. Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsub = rig.on("send:success", (event) => {
   *   console.log(`Sent to ${event.uri}`);
   * });
   *
   * // Later:
   * unsub();
   * ```
   */
  on(event: RigEventName, handler: EventHandler): () => void {
    return this._events.on(event, handler);
  }

  /** Remove a specific event handler. */
  off(event: RigEventName, handler: EventHandler): void {
    this._events.off(event, handler);
  }

  /**
   * Register a react pattern at runtime. Returns an unsubscribe function.
   *
   * Fires on successful `send()` or `receive()` when the written URI
   * matches the pattern. Fire-and-forget — errors are caught and logged.
   *
   * Reactions return `Output[]` — those tuples flow back through
   * `rig.send` (full pipeline). See chapter 7 of RFC 001 for the
   * productive-observation model.
   *
   * @example
   * ```typescript
   * const unsub = rig.reaction(
   *   "mutable://app/users/:id",
   *   async (out, _read, { id }) => {
   *     return [[`notify://email/${id}`, { kind: "user-updated" }]];
   *   },
   * );
   *
   * // Later:
   * unsub();
   * ```
   */
  reaction(pattern: string, handler: ReactionHandler): () => void {
    return this._reactors.add(pattern, handler);
  }

  // ── Reactive ──

  /**
   * Watch a URI for changes, yielding new values as they appear.
   *
   * Polls the URI at `intervalMs` (default 1000ms) and yields the value
   * whenever it changes. Uses JSON comparison for deduplication — only
   * emits when the data actually differs from the previous read.
   *
   * Pass an `AbortSignal` to stop watching.
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   *
   * for await (const profile of rig.watch<UserProfile>(
   *   "mutable://app/users/alice",
   *   { intervalMs: 2000, signal: abort.signal },
   * )) {
   *   console.log("Profile updated:", profile);
   * }
   * ```
   */
  async *watch<T = unknown>(
    uri: string,
    options?: WatchOptions,
  ): AsyncGenerator<T | null, void, unknown> {
    const interval = options?.intervalMs ?? 1000;
    const signal = options?.signal;

    let lastJson: string | undefined;

    while (!signal?.aborted) {
      const value = await this.readData<T>(uri);
      const json = JSON.stringify(value);

      if (json !== lastJson) {
        lastJson = json;
        yield value;
      }

      // Wait for next poll or abort
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  /**
   * Watch a URI prefix for collection-level changes.
   *
   * Polls the prefix, reads all items, and yields a snapshot whenever the
   * collection changes — items added, removed, or modified. Useful for
   * dashboards, lists, and any UI that renders a collection.
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   *
   * for await (const snapshot of rig.watchAll<UserProfile>(
   *   "mutable://app/users",
   *   { intervalMs: 2000, signal: abort.signal },
   * )) {
   *   console.log(`${snapshot.items.size} users`);
   *   console.log("Added:", snapshot.added);
   *   console.log("Removed:", snapshot.removed);
   *   console.log("Changed:", snapshot.changed);
   * }
   * ```
   */
  async *watchAll<T = unknown>(
    prefix: string,
    options?: WatchAllOptions,
  ): AsyncGenerator<WatchAllSnapshot<T>, void, unknown> {
    const interval = options?.intervalMs ?? 1000;
    const signal = options?.signal;

    let lastItems = new Map<string, string>(); // uri → JSON

    while (!signal?.aborted) {
      const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
      const results = await this.read<T>(listPrefix);
      const items = new Map<string, T>();
      for (const r of results) {
        if (r.success && r.record && r.uri) {
          items.set(r.uri, r.record.data);
        }
      }
      const currentJson = new Map<string, string>();
      for (const [uri, data] of items) {
        currentJson.set(uri, JSON.stringify(data));
      }

      // Diff against previous
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      for (const uri of currentJson.keys()) {
        if (!lastItems.has(uri)) {
          added.push(uri);
        } else if (lastItems.get(uri) !== currentJson.get(uri)) {
          changed.push(uri);
        }
      }
      for (const uri of lastItems.keys()) {
        if (!currentJson.has(uri)) {
          removed.push(uri);
        }
      }

      // Emit if anything changed (or on first poll)
      if (
        lastItems.size === 0 || added.length > 0 || removed.length > 0 ||
        changed.length > 0
      ) {
        yield { items, added, removed, changed };
      }

      lastItems = currentJson;

      // Wait for next poll or abort
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }
}

// ── Init helpers ──

/**
 * Build dispatch from per-op route arrays.
 *
 * Each operation flows through its dedicated route list:
 * - `receive`: broadcast to ALL matching connections in the receive route.
 * - `read`: first-match in declaration order; list reads (trailing slash)
 *   gather across every matching connection.
 * - `observe`: first-match in declaration order (client handles transport).
 * - `status`: aggregate across unique clients seen on any route.
 */
function createRouteDispatch(
  routes: {
    receive: readonly Connection[];
    read: readonly Connection[];
    observe: readonly Connection[];
  },
): ProtocolInterfaceNode {
  const { receive, read, observe } = routes;

  return {
    async receive(msgs: Output[]): Promise<ReceiveResult[]> {
      const results: ReceiveResult[] = [];
      for (const msg of msgs) {
        const [uri] = msg;
        const matching = receive.filter((s) => s.accepts(uri));
        if (matching.length === 0) {
          results.push({
            accepted: false,
            error: `No receive route accepts ${uri}`,
          });
          continue;
        }
        // Broadcast to every matching receive-route connection
        const writeResults = await Promise.all(
          matching.map((s) => s.client.receive([msg]).then((r) => r[0])),
        );
        const failed = writeResults.find((r) => !r.accepted);
        results.push(failed ?? writeResults[0]);
      }
      return results;
    },

    async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      const allResults: ReadResult<T>[] = [];

      for (const uri of uriList) {
        // Strip trailing slash for pattern matching (read patterns cover both)
        const isList = uri.endsWith("/");
        const matchUri = isList ? uri.slice(0, -1) : uri;

        if (isList) {
          // List reads: gather across every matching read-route connection.
          const merged: ReadResult<T>[] = [];
          let any = false;
          for (const s of read) {
            if (!s.accepts(matchUri)) continue;
            any = true;
            const part = await s.client.read<T>(uri);
            merged.push(...part);
          }
          if (!any) {
            allResults.push({
              success: false,
              error: `No read route accepts ${uri}`,
            });
          } else {
            allResults.push(...merged);
          }
          continue;
        }

        // Point reads: first connection with a successful hit wins.
        let found = false;
        for (const s of read) {
          if (!s.accepts(matchUri)) continue;
          const results = await s.client.read<T>(uri);
          if (results.length > 0 && results.some((r) => r.success)) {
            allResults.push(...results);
            found = true;
            break;
          }
        }
        if (!found) {
          allResults.push({
            success: false,
            error: `No read route has data for ${uri}`,
          });
        }
      }

      return allResults;
    },

    async *observe<T = unknown>(
      pattern: string,
      signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      // Strip :param and * segments to get the matchable prefix
      const segments = pattern.split("/");
      const matchUri = segments
        .filter((s) => !s.startsWith(":") && s !== "*")
        .join("/");

      for (const conn of observe) {
        if (conn.accepts(matchUri)) {
          yield* conn.client.observe<T>(pattern, signal);
          return;
        }
      }
    },

    async status(): Promise<StatusResult> {
      const seen = new Set<ProtocolInterfaceNode>();
      const unique: ProtocolInterfaceNode[] = [];
      for (const list of [receive, read, observe]) {
        for (const s of list) {
          if (!seen.has(s.client)) {
            seen.add(s.client);
            unique.push(s.client);
          }
        }
      }
      const results = await Promise.all(unique.map((c) => c.status()));
      const allSchema = new Set<string>();
      for (const r of results) {
        if (r.schema) {
          for (const k of r.schema) allSchema.add(k);
        }
      }
      const unhealthy = results.find((r) => r.status === "unhealthy");
      if (unhealthy) return { ...unhealthy, schema: [...allSchema] };
      const degraded = results.find((r) => r.status === "degraded");
      if (degraded) return { ...degraded, schema: [...allSchema] };
      return { status: "healthy", schema: [...allSchema] };
    },
  };
}

// ── Compile-time assertion ──
// Rig structurally satisfies ProtocolInterfaceNode, so it can be
// passed directly to any function that expects a client.
// deno-lint-ignore no-unused-vars
const _rigIsClient: ProtocolInterfaceNode = null! as Rig;

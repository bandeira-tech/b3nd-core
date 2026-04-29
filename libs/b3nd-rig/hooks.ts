/**
 * @module
 * Hook types and runners for the Rig.
 *
 * Security model:
 * - Before-hooks THROW to reject an operation. The caller must catch explicitly.
 *   No silent aborts — if validation fails, it's an exception.
 * - After-hooks OBSERVE but cannot modify the result.
 *   They can throw if a post-condition is violated.
 * - Hooks are immutable after init. Want different hooks? Create a new rig.
 * - One function per hook. Need composition? Compose on your end.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

import type { B3ndError, Output, ProgramResult } from "../b3nd-core/types.ts";

// ── Per-operation context types ──

/**
 * Context for a send hook.
 *
 * `message` is the input tuple the host application is putting on the
 * wire. Send hooks fire per-tuple; before-hooks may rewrite the tuple
 * by returning `{ ctx: { message: newTuple } }`.
 */
export interface SendCtx {
  message: Output;
}

/** Context for a receive hook. */
export interface ReceiveCtx {
  uri: string;
  data: unknown;
}

/** Context for a read hook. */
export interface ReadCtx {
  uri: string;
}

// ── Hook function types ──

/**
 * Before-hook. Runs before the operation.
 *
 * - Return `void` to proceed unchanged.
 * - Return `{ ctx }` to replace the context (e.g. rewrite a URI).
 * - **Throw** to reject the operation.
 */
export type BeforeHook<C> = (
  ctx: Readonly<C>,
) => void | { ctx: C } | Promise<void | { ctx: C }>;

/**
 * After-hook. Runs after the operation completes.
 *
 * Cannot modify the result. Use for logging, auditing, or enforcement.
 * Throw if a post-condition is violated.
 */
export type AfterHook<C> = (
  ctx: Readonly<C>,
  result: unknown,
) => void | Promise<void>;

// ── Error hook ──

/** Where in the pipeline the error occurred. */
export type ErrorPhase = "process" | "handle" | "route" | "reaction";

/**
 * Context passed to the `onError` hook.
 *
 * Carries enough detail to identify the failing pipeline stage and
 * the tuple involved. Optional fields are populated per phase:
 *
 * - `process` — `input`, `error`, `cause` (when an exception was thrown)
 * - `handle`  — `input`, `classification`, `error`, `cause`
 * - `route`   — `input`, `emission`, `connectionId`, `error`, `errorDetail`
 * - `reaction`— `input`, `emission`, `pattern`, `error`, `cause`
 */
export interface ErrorHookCtx {
  /** Which pipeline stage produced the error. */
  readonly phase: ErrorPhase;
  /** The original input tuple driving this slice of work. */
  readonly input: Output;
  /** For `route` and `reaction`, the emission being dispatched. */
  readonly emission?: Output;
  /** For `route`, the stable ID of the connection that rejected. */
  readonly connectionId?: string;
  /** For `handle`, the classification produced by `process()`. */
  readonly classification?: ProgramResult;
  /** For `reaction`, the URI pattern that matched. */
  readonly pattern?: string;
  /** Human-readable error message. */
  readonly error: string;
  /** Structured error info when the underlying client returned one. */
  readonly errorDetail?: B3ndError;
  /** The original thrown value, when an exception occurred. */
  readonly cause?: unknown;
}

/**
 * Error hook — called synchronously (in the catch path) for every
 * error the rig observes during a `send`/`receive` operation.
 *
 * **Throw to abort.** A throw propagates up through the operation
 * handle: `await op` rejects with the thrown value, `await op.settled`
 * rejects, and any in-flight reactions/routes for the operation stop
 * being dispatched. (Routes already in flight at the underlying client
 * cannot be unrun; the rig stops scheduling new ones.)
 *
 * **Return** to let the rig keep going with normal error handling: the
 * affected tuple records `accepted: false`, the corresponding
 * direction-level `*:error` event fires, and the operation's other
 * tuples continue.
 *
 * Use the hook for fail-fast policies (drop the whole batch on first
 * program rejection), structured error reporting, or to convert
 * specific phases into application-level exceptions.
 */
export type OnErrorHook = (
  ctx: Readonly<ErrorHookCtx>,
) => void | Promise<void>;

// ── Resolved hooks (internal) ──

/** The full set of hooks for all operations. Frozen after init. */
export interface RigHooks {
  readonly beforeSend: BeforeHook<SendCtx> | null;
  readonly afterSend: AfterHook<SendCtx> | null;
  readonly beforeReceive: BeforeHook<ReceiveCtx> | null;
  readonly afterReceive: AfterHook<ReceiveCtx> | null;
  readonly beforeRead: BeforeHook<ReadCtx> | null;
  readonly afterRead: AfterHook<ReadCtx> | null;
  readonly onError: OnErrorHook | null;
}

/** Config shape for hooks on RigConfig. */
export interface HooksConfig {
  beforeSend?: BeforeHook<SendCtx>;
  afterSend?: AfterHook<SendCtx>;
  beforeReceive?: BeforeHook<ReceiveCtx>;
  afterReceive?: AfterHook<ReceiveCtx>;
  beforeRead?: BeforeHook<ReadCtx>;
  afterRead?: AfterHook<ReadCtx>;
  /** Synchronous error hook — throw to abort the operation. */
  onError?: OnErrorHook;
}

// ── Factory ──

/** Create frozen hooks from config. */
export function resolveHooks(config?: HooksConfig): RigHooks {
  return Object.freeze({
    beforeSend: config?.beforeSend ?? null,
    afterSend: config?.afterSend ?? null,
    beforeReceive: config?.beforeReceive ?? null,
    afterReceive: config?.afterReceive ?? null,
    beforeRead: config?.beforeRead ?? null,
    afterRead: config?.afterRead ?? null,
    onError: config?.onError ?? null,
  });
}

/**
 * Run the onError hook with a given context. Returns `true` if the
 * hook threw — the caller is expected to propagate the throw and
 * abort the operation. Returns `false` if the hook returned normally
 * (or there is no hook installed) — the caller proceeds with normal
 * error handling.
 *
 * The hook's own throw is re-thrown by this runner so the call site
 * sees it. Returning `true` here is just a convenience for call sites
 * that want to branch.
 */
export async function runOnError(
  hook: OnErrorHook | null,
  ctx: ErrorHookCtx,
): Promise<void> {
  if (!hook) return;
  // Hook may be sync or return a promise. Await it; throws propagate.
  await hook(ctx);
}

// ── Runners ──

/**
 * Run a before-hook. Returns the (possibly replaced) context.
 * Throws if the hook throws — this is the rejection mechanism.
 */
export async function runBefore<C>(
  hook: BeforeHook<C> | null,
  ctx: C,
): Promise<C> {
  if (!hook) return ctx;
  const result = await hook(ctx);
  if (result != null && typeof result === "object" && "ctx" in result) {
    return result.ctx;
  }
  return ctx;
}

/**
 * Run an after-hook. The result is passed as read-only context.
 * After-hooks cannot modify the result.
 */
export async function runAfter<C>(
  hook: AfterHook<C> | null,
  ctx: C,
  result: unknown,
): Promise<void> {
  if (!hook) return;
  await hook(ctx, result);
}

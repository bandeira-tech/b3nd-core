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

import type { Output } from "../b3nd-core/types.ts";

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

// ── Resolved hooks (internal) ──

/** The full set of hooks for all operations. Frozen after init. */
export interface RigHooks {
  readonly beforeSend: BeforeHook<SendCtx> | null;
  readonly afterSend: AfterHook<SendCtx> | null;
  readonly beforeReceive: BeforeHook<ReceiveCtx> | null;
  readonly afterReceive: AfterHook<ReceiveCtx> | null;
  readonly beforeRead: BeforeHook<ReadCtx> | null;
  readonly afterRead: AfterHook<ReadCtx> | null;
}

/** Config shape for hooks on RigConfig. */
export interface HooksConfig {
  beforeSend?: BeforeHook<SendCtx>;
  afterSend?: AfterHook<SendCtx>;
  beforeReceive?: BeforeHook<ReceiveCtx>;
  afterReceive?: AfterHook<ReceiveCtx>;
  beforeRead?: BeforeHook<ReadCtx>;
  afterRead?: AfterHook<ReadCtx>;
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
  });
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

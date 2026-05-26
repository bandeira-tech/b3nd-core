/**
 * @module
 * b3nd Rig — the universal harness for b3nd networks.
 *
 * Identity, connection, send/receive, and observation.
 *
 * @example
 * ```typescript
 * import { connection, Rig } from "@bandeira-tech/b3nd-core/rig";
 *
 * const rig = new Rig({
 *   routes: { receive: [local], read: [local], observe: [local] },
 * });
 * await rig.receive([["mutable://app/key", { hello: "world" }]]);
 * ```
 */

// ── Rig ──
export { Rig } from "./rig.ts";
export type { RigConfig, RigInfo, RigRoutes } from "./types.ts";

// ── OperationHandle ──
export type {
  HandleEmitEvent,
  HandleErrorEvent,
  OperationEventHandler,
  OperationEventMap,
  OperationEventName,
  OperationHandle,
  ProcessDoneEvent,
  ProcessErrorEvent,
  ReactionErrorEvent,
  RouteErrorEvent,
  RouteSuccessEvent,
  SettledEvent,
} from "./operation-handle.ts";

// ── Connection ──
export { connection } from "./connection.ts";
export type { Connection, ConnectionOptions } from "./connection.ts";

// ── Hooks ──
export type {
  AfterHook,
  BeforeHook,
  ErrorHookCtx,
  ErrorPhase,
  HooksConfig,
  OnErrorHook,
  ReadCtx,
  ReceiveCtx,
  RigHooks,
  SendCtx,
} from "./hooks.ts";
export { resolveHooks, runAfter, runBefore, runOnError } from "./hooks.ts";

// ── Events ──
export type { EventHandler, RigEvent, RigEventName } from "./events.ts";
export { RigEventEmitter } from "./events.ts";

// ── Reactions ──
export type { ReactionHandler } from "./reactions.ts";
export { matchPattern, ReactionRegistry } from "./reactions.ts";

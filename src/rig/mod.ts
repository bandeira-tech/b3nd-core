/**
 * @module
 * b3nd Rig — the universal harness for b3nd networks.
 *
 * Identity, connection, send/receive, and observation.
 * For the full toolkit (hash, encrypt, message layer),
 * use the bundle: `@bandeira-tech/b3nd-web` or `@bandeira-tech/b3nd-sdk`.
 *
 * @example
 * ```typescript
 * import { Rig, connection } from "@bandeira-tech/b3nd-core/rig";
 * import { Identity } from "@bandeira-tech/b3nd-core/identity";
 *
 * const id = await Identity.fromSeed("my-secret");
 * const rig = new Rig({
 *   routes: { receive: [local], read: [local], observe: [local] },
 * });
 * await rig.send([["mutable://app/key", { hello: "world" }]]);
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

// httpApi moved to @bandeira-tech/b3nd-move/http/service in 0.17.
// Backend factory moved to @bandeira-tech/b3nd-save/factory in 0.16.

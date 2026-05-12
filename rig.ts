/**
 * @module
 * Rig subpath — the orchestration layer of B3nd.
 *
 * Bundles `Rig`, `connection`, hooks,
 * events, and reactions. Browsers and
 * servers alike can pull this in to compose a node without reaching
 * for the root export.
 *
 * Server-side composition (`createServers`, `ServerResolver`, CORS,
 * transports) lives in `@bandeira-tech/b3nd-servers`.
 *
 * Tree-shakers will drop unused symbols — if you only need `HttpClient`
 * or `WebSocketClient`, prefer the dedicated `./client-http` /
 * `./client-ws` subpaths instead.
 */

// ── Rig ──
export { Rig } from "./libs/b3nd-rig/rig.ts";
export type { RigConfig, RigInfo, RigRoutes } from "./libs/b3nd-rig/types.ts";

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
} from "./libs/b3nd-rig/operation-handle.ts";

// ── Connection ──
export { connection } from "./libs/b3nd-rig/connection.ts";
export type {
  Connection,
  ConnectionOptions,
} from "./libs/b3nd-rig/connection.ts";

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
} from "./libs/b3nd-rig/hooks.ts";
export {
  resolveHooks,
  runAfter,
  runBefore,
  runOnError,
} from "./libs/b3nd-rig/hooks.ts";

// ── Events ──
export type {
  EventHandler,
  RigEvent,
  RigEventName,
} from "./libs/b3nd-rig/events.ts";
export { RigEventEmitter } from "./libs/b3nd-rig/events.ts";

// ── Reactions ──
export type { ReactionHandler } from "./libs/b3nd-rig/reactions.ts";
export { matchPattern, ReactionRegistry } from "./libs/b3nd-rig/reactions.ts";

// httpApi moved to @bandeira-tech/b3nd-servers/http/api in 0.17.
// Backend factory moved to @bandeira-tech/b3nd-stores/factory in 0.16.

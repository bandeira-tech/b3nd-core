/**
 * @module
 * Rig subpath — the orchestration layer of B3nd.
 *
 * Bundles `Rig`, `connection`, the `ServerResolver` contract, the
 * backend-factory URL helpers, hooks, events, reactions, and the HTTP
 * API helper. Browsers and servers alike can pull this in to compose
 * a node without reaching for the root export.
 *
 * Tree-shakers will drop unused symbols — if you only need `HttpClient`
 * or `WebSocketClient`, prefer the dedicated `./client-http` /
 * `./client-ws` subpaths instead.
 */

// ── Rig ──
export { Rig } from "./libs/b3nd-rig/rig.ts";
export type {
  RigConfig,
  RigInfo,
  RigRoutes,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./libs/b3nd-rig/types.ts";

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

// ── HTTP API helper ──
export { httpApi } from "./libs/b3nd-rig/http.ts";
export type { HttpApiOptions } from "./libs/b3nd-rig/http.ts";

// ── Server factory ──
export { createServers } from "./libs/b3nd-rig/server-factory.ts";
export type {
  ServerResolver,
  TransportServer,
} from "./libs/b3nd-rig/server-factory.ts";

// ── Backend factory ──
export {
  createClientFromUrl,
  createClientResolver,
  createStoreFromUrl,
  createStoreResolver,
  getSupportedProtocols,
} from "./libs/b3nd-rig/backend-factory.ts";
export type {
  BackendFactoryOptions,
  BackendResolver,
  StoreClientConstructor,
} from "./libs/b3nd-rig/backend-factory.ts";

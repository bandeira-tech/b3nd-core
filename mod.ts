/**
 * @module
 * B3nd Core — framework foundation.
 *
 * Everything the framework needs to run a decentralized/distributed
 * network: types, encoding, clients, Rig, Identity, connection,
 * hooks, events, reactions, HTTP API, backend factory, and network
 * primitives.
 */

// ── Core types & encoding ──

export type {
  B3ndError,
  ClientError,
  CodeHandler,
  DeleteResult,
  HealthStatus,
  Message,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReadFn,
  ReceiveResult,
  StatusResult,
  WriteResult,
} from "./libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "./libs/b3nd-core/types.ts";

export {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./libs/b3nd-core/encoding.ts";

// ── Protocol clients ──
//
// Store→Client adapters (SimpleClient, DataStoreClient) moved to
// @bandeira-tech/b3nd-stores/adapters in 0.16. FunctionalClient
// stays here — no Store dependency.

export { FunctionalClient } from "./libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "./libs/b3nd-core/functional-client.ts";

// ── ObserveEmitter ──

export { ObserveEmitter } from "./libs/b3nd-core/observe-emitter.ts";
export type { ObserveListener } from "./libs/b3nd-core/observe-emitter.ts";

// ── Built-in transport clients ──
//
// HttpClient, WebSocketClient (+ httpApi) moved to
// @bandeira-tech/b3nd-servers in 0.17 (each pairs with its server
// half there). MemoryStore moved to @bandeira-tech/b3nd-stores in
// 0.16. ConsoleClient stays — write-only sink with no server side.

export { ConsoleClient } from "./libs/b3nd-client-console/client.ts";

// ── Rig ──

export { Identity } from "./libs/b3nd-rig/identity.ts";
export type { ExportedIdentity } from "./libs/b3nd-rig/identity.ts";
export { Rig } from "./libs/b3nd-rig/rig.ts";
export type { RigConfig, RigInfo, RigRoutes } from "./libs/b3nd-rig/types.ts";

// OperationHandle
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

// Hooks
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

// Events
export type {
  EventHandler,
  RigEvent,
  RigEventName,
} from "./libs/b3nd-rig/events.ts";
export { RigEventEmitter } from "./libs/b3nd-rig/events.ts";

// Reactions
export type { ReactionHandler } from "./libs/b3nd-rig/reactions.ts";
export { matchPattern, ReactionRegistry } from "./libs/b3nd-rig/reactions.ts";

// Connection
export { connection } from "./libs/b3nd-rig/connection.ts";
export type {
  Connection,
  ConnectionOptions,
} from "./libs/b3nd-rig/connection.ts";

// httpApi moved to @bandeira-tech/b3nd-servers/http/api in 0.17.
// Backend factory moved to @bandeira-tech/b3nd-stores/factory in 0.16.

// ── Network primitives ──

export { network } from "./libs/b3nd-network/network.ts";
export { peer } from "./libs/b3nd-network/peer.ts";
export { flood } from "./libs/b3nd-network/policies/flood.ts";
export { pathVector } from "./libs/b3nd-network/policies/path-vector.ts";
export { tellAndRead } from "./libs/b3nd-network/policies/tell-and-read.ts";
export { bestEffort } from "./libs/b3nd-network/decorators.ts";
export type {
  InboundCtx,
  NetworkOptions,
  Peer,
  PeerDecorator,
  Policy,
  StrategyFactory,
} from "./libs/b3nd-network/types.ts";
export type {
  TellAndReadBundle,
  TellAndReadOptions,
} from "./libs/b3nd-network/policies/tell-and-read.ts";

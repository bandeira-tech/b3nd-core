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
  HttpClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  Message,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReadFn,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "../libs/b3nd-core/types.ts";

export {
  decodeBinaryFromJson,
  encodeBinaryForJson,
  isBinary,
  isEncodedBinary,
} from "../libs/b3nd-core/binary.ts";

export { decodeHex, encodeHex } from "../libs/b3nd-core/encoding.ts";

// ── Protocol clients (Store → ProtocolInterfaceNode) ──

export { SimpleClient } from "../libs/b3nd-core/simple-client.ts";
export { DataStoreClient } from "../libs/b3nd-core/data-store-client.ts";
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// ── ObserveEmitter ──

export { ObserveEmitter } from "../libs/b3nd-core/observe-emitter.ts";
export type { ObserveListener } from "../libs/b3nd-core/observe-emitter.ts";

// ── Built-in clients ──

export { MemoryStore } from "../libs/b3nd-client-memory/store.ts";
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { ConsoleClient } from "../libs/b3nd-client-console/client.ts";

// ── Rig ──

export { Identity } from "../libs/b3nd-rig/identity.ts";
export type { ExportedIdentity } from "../libs/b3nd-rig/identity.ts";
export { Rig } from "../libs/b3nd-rig/rig.ts";
export type {
  RigConfig,
  RigInfo,
  RigRoutes,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/types.ts";

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
} from "../libs/b3nd-rig/operation-handle.ts";

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
} from "../libs/b3nd-rig/hooks.ts";
export {
  resolveHooks,
  runAfter,
  runBefore,
  runOnError,
} from "../libs/b3nd-rig/hooks.ts";

// Events
export type {
  EventHandler,
  RigEvent,
  RigEventName,
} from "../libs/b3nd-rig/events.ts";
export { RigEventEmitter } from "../libs/b3nd-rig/events.ts";

// Reactions
export type { ReactionHandler } from "../libs/b3nd-rig/reactions.ts";
export { matchPattern, ReactionRegistry } from "../libs/b3nd-rig/reactions.ts";

// Connection
export { connection } from "../libs/b3nd-rig/connection.ts";
export type {
  Connection,
  ConnectionOptions,
} from "../libs/b3nd-rig/connection.ts";

// HTTP API
export { httpApi } from "../libs/b3nd-rig/http.ts";
export type { HttpApiOptions } from "../libs/b3nd-rig/http.ts";

// Server factory
export { createServers } from "../libs/b3nd-rig/server-factory.ts";
export type {
  ServerResolver,
  TransportServer,
} from "../libs/b3nd-rig/server-factory.ts";

// Backend factory
export {
  createClientFromUrl,
  createClientResolver,
  createStoreFromUrl,
  createStoreResolver,
  getSupportedProtocols,
} from "../libs/b3nd-rig/backend-factory.ts";
export type {
  BackendFactoryOptions,
  BackendResolver,
  StoreClientConstructor,
} from "../libs/b3nd-rig/backend-factory.ts";

// ── Network primitives ──

export { network } from "../libs/b3nd-network/network.ts";
export { peer } from "../libs/b3nd-network/peer.ts";
export { flood } from "../libs/b3nd-network/policies/flood.ts";
export { pathVector } from "../libs/b3nd-network/policies/path-vector.ts";
export { tellAndRead } from "../libs/b3nd-network/policies/tell-and-read.ts";
export { bestEffort } from "../libs/b3nd-network/decorators.ts";
export type {
  InboundCtx,
  NetworkOptions,
  Peer,
  PeerDecorator,
  Policy,
  StrategyFactory,
} from "../libs/b3nd-network/types.ts";
export type {
  TellAndReadBundle,
  TellAndReadOptions,
} from "../libs/b3nd-network/policies/tell-and-read.ts";

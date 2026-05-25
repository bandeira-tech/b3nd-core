/**
 * @module
 * B3nd Core — framework foundation.
 *
 * Everything the framework needs to run a decentralized/distributed
 * network: types, encoding, clients, Rig, Identity, connection,
 * hooks, events, reactions, and network primitives.
 */

// ── Core types & encoding ──

export type {
  B3ndError,
  ClientError,
  CodeHandler,
  DeleteResult,
  HealthStatus,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReadFn,
  ReceiveResult,
  StatusResult,
  WriteResult,
} from "./src/types/types.ts";
export { ErrorCode, Errors } from "./src/types/types.ts";

export {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./src/encoding/encoding.ts";

// ── Protocol clients ──

export { FunctionalClient } from "./src/functional-client/functional-client.ts";
export type { FunctionalClientConfig } from "./src/functional-client/functional-client.ts";

// ── ObserveEmitter ──

export { ObserveEmitter } from "./src/observe-emitter/observe-emitter.ts";
export type { ObserveListener } from "./src/observe-emitter/observe-emitter.ts";

// ── Built-in transport clients ──

export { ConsoleClient } from "./src/client-console/client.ts";

// ── Rig ──

export { Identity } from "./src/rig/identity.ts";
export type { ExportedIdentity } from "./src/rig/identity.ts";
export { Rig } from "./src/rig/rig.ts";
export type {
  ConnectionLike,
  RigConfig,
  RigInfo,
  RigRoutes,
  Route,
} from "./src/rig/types.ts";

export type { Acceptance } from "./src/rig/acceptance.ts";
export {
  and,
  any,
  not,
  or,
  patterns,
  prefix,
  schemas,
} from "./src/rig/acceptance.ts";

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
} from "./src/rig/operation-handle.ts";

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
} from "./src/rig/hooks.ts";
export {
  resolveHooks,
  runAfter,
  runBefore,
  runOnError,
} from "./src/rig/hooks.ts";

export type { EventHandler, RigEvent, RigEventName } from "./src/rig/events.ts";
export { RigEventEmitter } from "./src/rig/events.ts";

export type { ReactionHandler } from "./src/rig/reactions.ts";
export { matchPattern, ReactionRegistry } from "./src/rig/reactions.ts";

export { connection } from "./src/rig/connection.ts";
export type { Connection, ConnectionOptions } from "./src/rig/connection.ts";

// ── Network primitives ──

export { network } from "./src/network/network.ts";
export { peer } from "./src/network/peer.ts";
export { flood } from "./src/network/policies/flood.ts";
export { pathVector } from "./src/network/policies/path-vector.ts";
export { tellAndRead } from "./src/network/policies/tell-and-read.ts";
export { bestEffort } from "./src/network/decorators.ts";
export type {
  InboundCtx,
  NetworkOptions,
  Peer,
  PeerDecorator,
  Policy,
  StrategyFactory,
} from "./src/network/types.ts";
export type {
  TellAndReadBundle,
  TellAndReadOptions,
} from "./src/network/policies/tell-and-read.ts";

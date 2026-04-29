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
 * import { Rig, Identity, connection, createClientFromUrl } from "@b3nd/rig";
 * import { message } from "@bandeira-tech/b3nd-sdk/msg";
 *
 * const client = await createClientFromUrl("https://node.b3nd.net");
 * const rig = new Rig({
 *   connections: [connection(client, { receive: ["*"], read: ["*"] })],
 * });
 *
 * // Identity signs, rig delivers
 * const id = await Identity.fromSeed("my-secret");
 * const auth = [await id.sign({ inputs: [], outputs: [["mutable://app/key", { hello: "world" }]] })];
 * const envelope = await message({ auth, inputs: [], outputs: [["mutable://app/key", { hello: "world" }]] });
 * await rig.send([envelope]);
 *
 * // Read (no identity needed)
 * const results = await rig.read("mutable://app/key");
 * ```
 */

// Core
export { Identity } from "./identity.ts";
export type { ExportedIdentity } from "./identity.ts";
export { Rig } from "./rig.ts";
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
export type {
  RigConfig,
  RigInfo,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";

// Core types — re-exported so app-specific libs import from rig, not core
export type {
  CodeHandler,
  Message,
  Output,
  Program,
  ProgramResult,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
  Store,
} from "../b3nd-core/types.ts";
export { DataStoreClient } from "../b3nd-core/data-store-client.ts";

// Hooks (immutable after init — throw to reject, observe to audit)
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
export {
  resolveHooks,
  runAfter,
  runBefore,
  runOnError,
} from "./hooks.ts";

// Events
export type { EventHandler, RigEvent, RigEventName } from "./events.ts";
export { RigEventEmitter } from "./events.ts";

// Reactions — local write-reactions (fire-and-forget pattern matching)
export type { ReactionHandler } from "./reactions.ts";
export { matchPattern, ReactionRegistry } from "./reactions.ts";

// Connections — the single filtering primitive
export { connection } from "./connection.ts";
export type { Connection, ConnectionOptions } from "./connection.ts";
export type { RigRoutes } from "./types.ts";

// HTTP API — standalone function for serving a rig over HTTP
export { httpApi } from "./http.ts";
export type { HttpApiOptions } from "./http.ts";

// Server factory — composable transport layer
export { createServers } from "./server-factory.ts";
export type { ServerResolver, TransportServer } from "./server-factory.ts";

// Backend factory
export {
  createClientFromUrl,
  createClientResolver,
  createStoreFromUrl,
  createStoreResolver,
  getSupportedProtocols,
} from "./backend-factory.ts";
export type {
  BackendFactoryOptions,
  BackendResolver,
  StoreClientConstructor,
} from "./backend-factory.ts";

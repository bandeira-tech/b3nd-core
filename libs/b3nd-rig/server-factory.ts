/**
 * @module
 * Server factory — composable transport layer for the rig.
 *
 * Mirrors the `BackendResolver` pattern for storage:
 *   BackendResolver  → maps URL → Store (storage side)
 *   ServerResolver   → maps Rig → TransportServer (serving side)
 *
 * Each transport (HTTP, gRPC, WebSocket, …) implements `ServerResolver`.
 * `createServers()` wires them all up:
 *
 * @example
 * ```typescript
 * import { httpServer } from "@b3nd/server-http";
 * import { grpcServer } from "@b3nd/server-grpc";
 *
 * const servers = createServers(rig, [
 *   httpServer({ port: 3000 }),
 *   grpcServer({ port: 50051 }),
 * ]);
 * await Promise.all(servers.map(s => s.start()));
 * ```
 */

import type { Rig } from "./rig.ts";

/**
 * A running transport server — lifecycle + identity.
 *
 * Created by a `ServerResolver`. Start/stop control the underlying
 * listener (Deno.serve, net.listen, etc.).
 */
export interface TransportServer {
  /** Transport name: "http", "grpc", "ws", etc. */
  readonly transport: string;
  /** Listening address, e.g. "http://0.0.0.0:3000" */
  readonly address: string;
  /** Start accepting connections. */
  start(): Promise<void>;
  /** Graceful shutdown. */
  stop(): Promise<void>;
}

/**
 * Factory that creates a TransportServer for a given rig.
 *
 * Implement one per transport. The resolver holds configuration
 * (port, CORS, TLS, etc.) — `create()` wires it to a live rig.
 */
export interface ServerResolver {
  /** Transport name — matches `TransportServer.transport`. */
  transport: string;
  /** Create a server bound to the given rig. */
  create(rig: Rig, options?: Record<string, unknown>): TransportServer;
}

/**
 * Create TransportServer instances from resolvers.
 *
 * Does not start them — call `.start()` on each (or `Promise.all`).
 *
 * @example
 * ```typescript
 * const servers = createServers(rig, [
 *   httpServer({ port: 3000 }),
 *   grpcServer({ port: 50051 }),
 * ]);
 * await Promise.all(servers.map(s => s.start()));
 * // Later:
 * await Promise.all(servers.map(s => s.stop()));
 * ```
 */
export function createServers(
  rig: Rig,
  resolvers: ServerResolver[],
): TransportServer[] {
  return resolvers.map((r) => r.create(rig));
}

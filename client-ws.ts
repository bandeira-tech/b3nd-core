/**
 * @module
 * WebSocketClient subpath — `ProtocolInterfaceNode` over WebSocket with
 * automatic reconnection. Universal — uses the standard `WebSocket`
 * global available in browsers, Deno, and Node 22+.
 */

export { WebSocketClient } from "./libs/b3nd-client-ws/mod.ts";
export type {
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
} from "./libs/b3nd-core/types.ts";

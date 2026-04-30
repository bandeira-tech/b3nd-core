/**
 * @module
 * HttpClient subpath — `ProtocolInterfaceNode` over HTTP for connecting
 * to remote B3nd nodes from any environment with `fetch`.
 *
 * Browser-safe. Import this directly to keep the bundle minimal when
 * the rest of the Rig surface isn't needed.
 */

export { HttpClient } from "./libs/b3nd-client-http/mod.ts";
export type { HttpClientConfig } from "./libs/b3nd-core/types.ts";

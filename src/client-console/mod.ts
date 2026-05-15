/**
 * Console backend for b3nd.
 *
 * Write-only client that logs operations to the console. Useful for debugging,
 * auditing, and piping protocol traffic to the terminal.
 *
 * This is a transport-style client — it has no underlying Store. Console
 * is a sink, not storage. (Same shape as the HTTP / WebSocket clients in
 * `@bandeira-tech/b3nd-move`, just locally addressed.)
 */

export { ConsoleClient } from "./client.ts";

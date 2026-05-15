/**
 * @b3nd/sdk Types
 * Core types for the universal B3nd protocol interface
 */

/**
 * Result of a write operation
 */
export interface WriteResult<T = unknown> {
  success: boolean;
  record?: { data: T };
  error?: string;
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  success: boolean;
  error?: string;
  errorDetail?: B3ndError;
}

/**
 * Health status response
 */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Status response — replaces health() + getSchema().
 * Each client reports its health + capabilities.
 * The rig aggregates and adds schema info.
 *
 * `fns` advertises the set of read functions this node supports
 * (`read`, `ls`, `count`, plus any provider-defined `x-*`). Clients
 * may use it to validate a request before dispatch or to surface
 * capability info to humans/diagnostic UIs.
 */
export interface StatusResult {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  schema?: string[];
  fns?: string[];
  details?: Record<string, unknown>;
}

/**
 * Output — the universal addressed-content primitive: [uri, payload]
 *
 * The framework treats `payload` as opaque on both sides. The first
 * element's meaning differs by direction:
 *
 * - **write** (`receive`, `send`, programs): `uri` is the destination
 *   address the payload is written under.
 * - **read** (`read` results): `uri` echoes the caller's input url so
 *   results pair positionally or by lookup. Payload shape depends on
 *   what the executing client / protocol decides — common patterns:
 *     - `fn=read`           → the stored value, or a protocol-defined
 *                              miss representation
 *     - `fn=ls&format=full` → `Output[]` of the entries under the prefix
 *     - `fn=ls&format=uris` → `string[]` — flat list of entry uris
 *     - `fn=count`          → `number`
 *     - `fn=x-…`            → provider-defined
 *
 * The framework does not dictate what a "miss" payload looks like, nor
 * what `null` means. Those are content/protocol concerns. Pick a
 * convention with your store/canon and document it there.
 */
export type Output<T = unknown> = [
  uri: string,
  payload: T,
];

/**
 * Message — alias for Output. A message is an addressed output.
 */
export type Message<D = unknown> = Output<D>;

/**
 * Read function for storage lookups.
 *
 * Single-url convenience used by program authors — wraps
 * `read([url])[0]`. Because `read` is 1:1 with its input, the tuple is
 * always present. What "miss" looks like in the payload is up to the
 * underlying protocol; the type parameter `T` should reflect that
 * (e.g. `T | undefined` if your protocol uses `undefined` for miss).
 */
export type ReadFn = <T = unknown>(
  url: string,
) => Promise<Output<T>>;

/**
 * Receive function — batch of messages through the rig pipeline.
 */
export type ReceiveFn = (msgs: Message[]) => Promise<ReceiveResult[]>;

// ── Program model ───────────────────────────────────────────────────

/**
 * Program result — classification of a message by a program.
 * Programs return protocol-defined codes, not binary valid/invalid.
 */
export interface ProgramResult {
  code: string;
  error?: string;
}

/**
 * Program — classifies a message and returns a protocol-defined code.
 *
 * Programs are pure classifiers with no side effects. A protocol ships its
 * own programs as a closed package — sub-output classification is handled
 * internally by the protocol, not by calling back into the rig.
 *
 * - `output`   — the [uri, payload] being classified
 * - `upstream` — the parent output (undefined at top level)
 * - `read`     — storage lookup (only confirmed state)
 */
export type Program<T = unknown> = (
  output: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ProgramResult>;

/**
 * Code handler — what to do when a program returns a specific code.
 *
 * Handlers are pure transforms: they take the classified output and
 * return the `Output[]` they want the Rig to dispatch. The Rig owns
 * the wire — handlers never call broadcast directly.
 *
 * Common shapes:
 * - persist:     `return [out]`            (the simple "write this" case)
 * - decompose:   `return [envelope, ...payload.outputs, ...deletions]`
 * - conditional: `return existing.success ? [] : [out]`
 * - refuse:      `return []`
 *
 * - `out`    — the classified output `[uri, payload]`
 * - `result` — the `ProgramResult` that produced this code
 * - `read`   — storage lookup (confirmed state)
 */
export type CodeHandler = (
  out: Output,
  result: ProgramResult,
  read: ReadFn,
) => Promise<Output[]>;

/**
 * Result of a receive operation.
 * `error` remains a string for backward compatibility.
 * `errorDetail` provides structured error info for programmatic handling.
 */
export interface ReceiveResult {
  accepted: boolean;
  error?: string;
  errorDetail?: B3ndError;
}

/**
 * ProtocolInterfaceNode — the universal interface implemented by all clients.
 *
 * Four primitives:
 * - `receive` — all state changes (writes)
 * - `read`    — all queries; urls carry the function and parameters
 * - `observe` — stream of changes for a set of urls
 * - `status`  — health + capabilities
 *
 * All B3nd clients (Memory, HTTP, WebSocket, Postgres, IndexedDB, etc.)
 * implement this interface, enabling recursive composition and uniform usage.
 */
export interface ProtocolInterfaceNode {
  /**
   * Receive a batch of messages — the unified entry point for all state changes.
   *
   * Each message is [uri, payload]. Clients interpret the payload per their
   * role (storage clients persist, audit clients append, forwarders forward).
   * Returns one ReceiveResult per message.
   *
   * The return type is `PromiseLike` (not `Promise`) so implementations
   * can return richer await-targets — e.g., the Rig returns an
   * `OperationHandle` that's awaitable AND exposes per-route events.
   * Plain `Promise<ReceiveResult[]>` still satisfies the contract.
   */
  receive(msgs: Message[]): PromiseLike<ReceiveResult[]>;

  /**
   * Read a batch of urls. A url is a uri plus a query string of read
   * parameters (`fn`, `limit`, `page`, `format`, `x-*` extensions, ...).
   * See `./url.ts` for the grammar.
   *
   * **Shape: 1:1 with input.** Returns one `Output<T>` per input url,
   * in input order. Each output is `[inputUrl, payload]` — the first
   * element echoes the caller's url so results are addressable
   * positionally or by lookup.
   *
   * Payload semantics are **content/protocol concerns** — the framework
   * does not interpret them. The executing client decides what `read`
   * misses, `ls` shapes, `count` answers, and `x-*` results look like;
   * callers and stores agree on the convention out-of-band.
   *
   * **Errors:**
   *  - Transport / programmer errors throw (network down, malformed
   *    url, unknown `fn`, no route accepts).
   *  - Anything else — including "not found", auth refusals, etc. —
   *    is encoded in the payload per the protocol's own convention.
   *
   * @example
   * ```ts
   * const [profile, total, posts] = await pin.read([
   *   "mutable://users/alice",
   *   "mutable://users/alice/posts/?fn=count",
   *   "mutable://users/alice/posts/?format=uris&limit=12",
   * ]);
   * profile[1]; // whatever the store returns for a point read
   * total[1];   // whatever the store returns for fn=count
   * posts[1];   // whatever the store returns for fn=ls&format=uris
   * ```
   */
  read<T = unknown>(urls: string[]): Promise<Output<T>[]>;

  /**
   * Observe a batch of urls. Yields `Output<string[]>` packages —
   * INV-style bundles of uris that changed under a watched pattern.
   * The observer reads each uri to learn its current state.
   *
   * Each yielded `Output` is `[inputUrl, uris]` where `inputUrl` is
   * one of the caller's subscription urls — the one whose pattern
   * matched the change — and `uris` is the list of uris that fired
   * in this batch. A single change matching multiple subscription
   * urls yields once per matching url. Backends may emit one uri per
   * package or batch many — the consumer iterates either way.
   *
   * The `signal` controls lifecycle — abort to stop observing.
   *
   * @example
   * ```ts
   * const abort = new AbortController();
   * for await (const [, uris] of client.observe(["mutable://market/*"], abort.signal)) {
   *   const outputs = await client.read(uris);
   *   for (const [uri, payload] of outputs) console.log(uri, payload);
   * }
   * ```
   */
  observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<Output<string[]>>;

  /**
   * Status — health + capabilities.
   * Clients report health. The rig aggregates and adds schema.
   */
  status(): Promise<StatusResult>;
}

// HttpClientConfig, WebSocketClientConfig, WebSocketRequest, and
// WebSocketResponse moved to @bandeira-tech/b3nd-move in 0.17
// (each lives next to its client implementation).
// Store, StoreEntry, StoreWriteResult, StoreCapabilities moved to
// @bandeira-tech/b3nd-save in 0.18 — Store is an internal abstraction
// of the save layer, not a core protocol concept.

/**
 * Structured error codes for programmatic error handling.
 * Callers can switch on `error.code` without string parsing.
 */
export enum ErrorCode {
  // Auth errors
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  // Validation errors
  INVALID_URI = "INVALID_URI",
  INVALID_SCHEMA = "INVALID_SCHEMA",
  INVALID_SEQUENCE = "INVALID_SEQUENCE",
  // State errors
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  // Internal errors
  STORAGE_ERROR = "STORAGE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Structured error returned by protocol operations.
 */
export interface B3ndError {
  code: ErrorCode;
  message: string;
  uri?: string;
  details?: unknown;
}

/**
 * Convenience constructors for B3ndError
 */
export const Errors = {
  unauthorized: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.UNAUTHORIZED,
    message: msg ?? "Unauthorized",
    uri,
  }),
  forbidden: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.FORBIDDEN,
    message: msg ?? "Forbidden",
    uri,
  }),
  invalidUri: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.INVALID_URI,
    message: msg ?? "Invalid URI",
    uri,
  }),
  invalidSchema: (uri: string, details?: unknown): B3ndError => ({
    code: ErrorCode.INVALID_SCHEMA,
    message: "Schema validation failed",
    uri,
    details,
  }),
  invalidSequence: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.INVALID_SEQUENCE,
    message: msg ?? "Invalid sequence number",
    uri,
  }),
  notFound: (uri: string): B3ndError => ({
    code: ErrorCode.NOT_FOUND,
    message: `Not found: ${uri}`,
    uri,
  }),
  conflict: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.CONFLICT,
    message: msg ?? "Conflict",
    uri,
  }),
  storageError: (msg: string, uri?: string): B3ndError => ({
    code: ErrorCode.STORAGE_ERROR,
    message: msg,
    uri,
  }),
  internal: (msg: string, uri?: string): B3ndError => ({
    code: ErrorCode.INTERNAL_ERROR,
    message: msg,
    uri,
  }),
};

/**
 * Error class for client operations
 * Preserves error context without hiding details
 */
export class ClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/**
 * Link value - just a string URI pointing to another resource
 */
export type LinkValue = string;

/**
 * Content-addressed data metadata (optional wrapper for hash:// data)
 */
export interface ContentData<T = unknown> {
  type?: string;
  encoding?: string;
  data: T;
}

// WebSocketRequest / WebSocketResponse moved to
// @bandeira-tech/b3nd-move/ws/client in 0.17.

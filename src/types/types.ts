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
 * `fns` advertises the set of named read functions this node supports,
 * if its locator grammar defines such a concept. Provider-specific —
 * the framework neither populates nor interprets it. Clients may use
 * it to surface capability info to humans/diagnostic UIs.
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
 * - **write** (`receive`, `send`, programs): `uri` is the canonical
 *   identifier the payload is written under.
 * - **read** (`read` results): the first element echoes the caller's
 *   input locator so results pair positionally or by lookup. Payload
 *   shape is entirely the executing client's choice — what a miss
 *   looks like, what a listing yields, what an extension function
 *   returns, all defined by the client's locator-grammar contract.
 */
export type Output<T = unknown> = [
  uri: string,
  payload: T,
];

/**
 * Read function for storage lookups.
 *
 * Single-locator convenience used by program authors — wraps
 * `read([locator])[0]`. Because `read` is 1:1 with its input, the
 * tuple is always present. What "miss" looks like in the payload is up
 * to the executing client; the type parameter `T` should reflect that
 * (e.g. `T | undefined` if your client uses `undefined` for miss).
 */
export type ReadFn = <T = unknown>(
  locator: string,
) => Promise<Output<T>>;

/**
 * Receive function — batch of outputs through the rig pipeline.
 */
export type ReceiveFn = (msgs: Output[]) => Promise<ReceiveResult[]>;

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
 * - `receive` — all state changes (writes), addressed by **uri**
 * - `read`    — all queries, addressed by **locator**
 * - `observe` — stream of changes, subscribed by **locator**
 * - `status`  — health + capabilities
 *
 * **URIs vs locators.** A *uri* is the canonical identifier of a
 * resource — used for writes and emitted on observe so listeners learn
 * which resource changed. A *locator* is any addressing string a caller
 * passes to `read`/`observe`: it may be a bare uri, a pattern with
 * wildcards, or a uri decorated with request-time directives. The
 * framework treats locators as opaque — it routes them by string
 * pattern matching and hands them to the executing client verbatim.
 * What grammar (if any) a locator follows is a contract between the
 * caller and the executing client (e.g. `@bandeira-tech/b3nd-save/url`
 * defines save's locator grammar).
 *
 * All B3nd clients (Memory, HTTP, WebSocket, Postgres, IndexedDB, etc.)
 * implement this interface, enabling recursive composition and uniform usage.
 */
export interface ProtocolInterfaceNode {
  /**
   * Receive a batch of outputs — the unified entry point for all state changes.
   *
   * Each output is `[uri, payload]` where `uri` is the canonical
   * resource identifier the payload is written under. Clients interpret
   * the payload per their role (storage clients persist, audit clients
   * append, forwarders forward). Returns one `ReceiveResult` per output.
   *
   * The return type is `PromiseLike` (not `Promise`) so implementations
   * can return richer await-targets — e.g., the Rig returns an
   * `OperationHandle` that's awaitable AND exposes per-route events.
   * Plain `Promise<ReceiveResult[]>` still satisfies the contract.
   */
  receive(msgs: Output[]): PromiseLike<ReceiveResult[]>;

  /**
   * Read a batch of locators.
   *
   * Locators are opaque to the framework: their grammar is a contract
   * between the caller and the executing client. The rig routes each
   * locator to the first connection whose pattern accepts it (pure
   * string pattern matching, no normalization).
   *
   * **Shape: 1:1 with input.** Returns one `Output<T>` per input
   * locator, in input order. Each output is `[inputLocator, payload]` —
   * the first element echoes the caller's locator so results are
   * addressable positionally or by lookup.
   *
   * Payload semantics are entirely the client's concern. What "not
   * found" looks like, what listing shapes look like, what extension
   * functions return — all defined by the executing client and agreed
   * with its callers out-of-band.
   *
   * **Errors:** transport / programmer errors throw (network down, no
   * route accepts, grammar violations the client rejects). Anything
   * else — "not found", auth refusals, etc. — is encoded in the payload
   * per the client's convention.
   */
  read<T = unknown>(locators: string[]): Promise<Output<T>[]>;

  /**
   * Observe a batch of locators. Yields INV-style batches of uris that
   * changed under any subscribed pattern. The observer reads each uri
   * to learn its current state.
   *
   * Locators are matched against emitted uris as segment-globs — pure
   * string pattern matching, no grammar awareness. Each yield is a
   * non-empty `readonly string[]` of concrete uris that fired in this
   * batch. Which of the caller's subscription locators matched is not
   * surfaced; the caller can re-match locally if it needs that routing,
   * which keeps the wire (and in-process surface) minimal.
   *
   * The `signal` controls lifecycle — abort to stop observing.
   *
   * @example
   * ```ts
   * const abort = new AbortController();
   * for await (const uris of client.observe(["mutable://market/*"], abort.signal)) {
   *   const outputs = await client.read(uris);
   *   for (const [uri, payload] of outputs) console.log(uri, payload);
   * }
   * ```
   */
  observe(
    locators: string[],
    signal: AbortSignal,
  ): AsyncIterable<readonly string[]>;

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

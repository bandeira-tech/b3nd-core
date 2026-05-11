/**
 * @module
 * URL grammar for read/observe — the single source of truth for
 * parsing and constructing b3nd urls.
 *
 * **Everything that handles a b3nd url should go through this module.**
 * Nothing else in the codebase (or in downstream backends, transports,
 * tests, or sugar packages) should re-implement query-string splitting,
 * fn detection, or protocol/hostname extraction.
 *
 * A **url** = a uri (the protocol-defined address) plus a query string of
 * read parameters. The uri is the identity used for routing, caching, and
 * observe-subscription keys. The query string carries request-time-only
 * directives that shape the response without changing identity.
 *
 * Grammar:
 *
 *     <uri>[?fn=<fn>][&<param>=<value>...][&x-<ns>.<key>=<value>...]
 *
 * Reserved `fn` values:
 * - `read`   — point read (default for non-trailing-slash uris)
 * - `ls`     — list under a prefix (default when uri ends with `/`)
 * - `count`  — count of entries under a prefix
 * - `x-*.*`  — provider-defined extension functions
 *
 * Standard params (meaningful only for some fns; clients ignore the rest):
 * `limit`, `page`, `cursor`, `sortBy`, `sortOrder`, `pattern`, `format`.
 *
 * Anything matching `x-<ns>.<key>` lands in the `ext` map and is passed
 * opaquely to the executing client. Callers inspect ext entries by their
 * flat string key (e.g. `ext["x-feed.cursor"]`).
 *
 * `parseUrl` returns a superset of the standard URL fields (`protocol`,
 * `hostname`, `path`, `program`) plus the b3nd-specific `fn`/`params`/`ext`.
 * Callers switch/destructure on the parsed result instead of importing
 * narrow boolean guards.
 */

// ── Read params + parsed url shape ──────────────────────────────────

/**
 * Standard read parameters. All are optional; clients interpret the
 * subset that makes sense for the requested fn and throw on the rest.
 */
export interface ReadParams {
  limit?: number;
  page?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: string;
  pattern?: string;
  format?: string;
}

/**
 * A parsed url decomposed into routing identity (`uri`), function
 * (`fn`), standard read parameters (`params`), and the `x-*` extension
 * bag (`ext`), plus the structural fields shared with WHATWG URL
 * (`protocol`, `hostname`, `path`, `program`).
 */
export interface ParsedUrl {
  /** Scheme without trailing `://` (e.g. `"mutable"`, `"b3nd"`). */
  protocol: string;
  /** Authority segment after `protocol://` (may be empty). */
  hostname: string;
  /** Everything after `protocol://<hostname>`. Empty or starts with `/`. */
  path: string;
  /** `protocol://hostname` — the routing root above the path. */
  program: string;
  /** Full routing identity: `program` + `path`. Query is stripped. */
  uri: string;
  /** Reserved fn (`read`/`ls`/`count`) or `x-<ns>.<name>` extension. */
  fn: string;
  /** Standard read params (numeric ones coerced). */
  params: ReadParams;
  /** Bag of `x-*` extension query params (every key starts with `x-`). */
  ext: Record<string, string>;
}

/**
 * Options accepted by the read-url helpers (`count`, `list`, ...).
 * Standard `ReadParams` plus an `ext` bag for `x-*` extensions.
 */
export type ReadOpts = ReadParams & { ext?: Record<string, string> };

/**
 * Parse a url into its structural fields, function, params, and extensions.
 *
 * Splitting rule: first `://` separates protocol from the rest; the first
 * `/` in the rest separates hostname from path. Embedded `://` in the path
 * (e.g. `b3nd://count/mutable://users/`) stays inside `path` — no
 * special-casing.
 *
 * Defaults:
 * - `fn=read` for uris without a trailing slash
 * - `fn=ls` for uris with a trailing slash
 *
 * Numeric params (`limit`, `page`) are coerced; throws on NaN.
 */
export function parseUrl(url: string): ParsedUrl {
  const qIdx = url.indexOf("?");
  const uri = qIdx < 0 ? url : url.slice(0, qIdx);
  const query = qIdx < 0 ? "" : url.slice(qIdx + 1);

  const schemeIdx = uri.indexOf("://");
  let protocol = "";
  let hostname = "";
  let path = "";
  if (schemeIdx >= 0) {
    protocol = uri.slice(0, schemeIdx);
    const rest = uri.slice(schemeIdx + 3);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      hostname = rest;
      path = "";
    } else {
      hostname = rest.slice(0, slash);
      path = rest.slice(slash);
    }
  } else {
    path = uri;
  }
  const program = protocol ? `${protocol}://${hostname}` : "";

  const sp = new URLSearchParams(query);
  const explicitFn = sp.get("fn") ?? undefined;
  const defaultFn = uri.endsWith("/") ? "ls" : "read";
  const fn = explicitFn ?? defaultFn;

  const params: ReadParams = {};
  const ext: Record<string, string> = {};

  for (const [key, value] of sp.entries()) {
    if (key === "fn") continue;
    if (key.startsWith("x-")) {
      ext[key] = value;
      continue;
    }
    switch (key) {
      case "limit":
      case "page": {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new Error(`Invalid ${key}: ${value}`);
        }
        params[key] = n;
        break;
      }
      case "cursor":
      case "sortBy":
      case "sortOrder":
      case "pattern":
      case "format":
        params[key] = value;
        break;
      default:
        throw new Error(`Unknown read param: ${key}`);
    }
  }

  return { protocol, hostname, path, program, uri, fn, params, ext };
}

/**
 * Serialize a parsed url back to its string form. Authoritative input is
 * `uri`; structural fields (`protocol`/`hostname`/`path`/`program`) are
 * ignored on serialization since `uri` already contains them.
 *
 * Omits `fn=` when it matches the trailing-slash default. Throws if any
 * `ext` key does not start with `x-`.
 */
export function buildUrl(parsed: {
  uri: string;
  fn?: string;
  params?: ReadParams;
  ext?: Record<string, string>;
}): string {
  const { uri, fn, params, ext } = parsed;
  const sp = new URLSearchParams();

  const defaultFn = uri.endsWith("/") ? "ls" : "read";
  if (fn && fn !== defaultFn) sp.set("fn", fn);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      sp.set(k, String(v));
    }
  }
  if (ext) {
    for (const [k, v] of Object.entries(ext)) {
      if (!k.startsWith("x-")) {
        throw new Error(`ext keys must start with 'x-': ${k}`);
      }
      sp.set(k, v);
    }
  }

  const qs = sp.toString();
  return qs ? `${uri}?${qs}` : uri;
}

/**
 * Routing identity for dispatch and observe-subscription. The query
 * string is request-time-only and never participates in routing.
 */
export function routingKey(url: string): string {
  const qIdx = url.indexOf("?");
  return qIdx < 0 ? url : url.slice(0, qIdx);
}

// ── Helpers ────────────────────────────────────────────────────────
// Compose at call sites: `pin.read([count(uri), list(uri, {limit: 20})])`.

function withTrailingSlash(uri: string): string {
  return uri.endsWith("/") ? uri : `${uri}/`;
}

/**
 * Build a `fn=count` url. Ensures a trailing slash on the uri.
 */
export function count(uri: string, opts?: ReadOpts): string {
  const { ext, ...params } = opts ?? {};
  return buildUrl({ uri: withTrailingSlash(uri), fn: "count", params, ext });
}

/**
 * Build a `fn=ls&format=full` url. Ensures a trailing slash on the uri.
 * Returns full records by default; use `listUris` for uri-only listings.
 */
export function list(uri: string, opts?: ReadOpts): string {
  const { ext, ...params } = opts ?? {};
  return buildUrl({
    uri: withTrailingSlash(uri),
    fn: "ls",
    params: { format: "full", ...params },
    ext,
  });
}

/**
 * Build a `fn=ls&format=uris` url. Ensures a trailing slash on the uri.
 * Records are omitted from the response; only `uri` is set on each item.
 */
export function listUris(uri: string, opts?: ReadOpts): string {
  const { ext, ...params } = opts ?? {};
  return buildUrl({
    uri: withTrailingSlash(uri),
    fn: "ls",
    params: { format: "uris", ...params },
    ext,
  });
}

/**
 * Build a url for a provider-defined `x-*` function.
 * Throws if `fnName` does not start with `x-`.
 */
export function x(
  uri: string,
  fnName: string,
  opts?: ReadOpts,
): string {
  if (!fnName.startsWith("x-")) {
    throw new Error(`x() requires fn name starting with 'x-': ${fnName}`);
  }
  const { ext, ...params } = opts ?? {};
  return buildUrl({ uri, fn: fnName, params, ext });
}

// ── Framework-reserved synthetic-content addresses ──────────────────
// The framework reserves `b3nd://` for any uri it has to invent —
// `fn=count` answers, observe-batch envelopes, etc. Other libraries may
// invent their own synthetic namespaces under their own protocols; the
// framework doesn't claim a generic "is this synthetic?" concept.

const B3ND_NS = "b3nd://";

/**
 * Build the address the executing client uses for a `fn=count` answer.
 * The original request uri is preserved as the tail so the answer is
 * self-describing.
 */
export const countUri = (uri: string): string => `${B3ND_NS}count/${uri}`;

/**
 * Default address for `observe` notification packages. Backends may
 * append `/<id>` or `/<pattern>` to disambiguate subscriptions.
 */
export const OBSERVE_URI: string = `${B3ND_NS}observe`;

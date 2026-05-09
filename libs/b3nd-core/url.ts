/**
 * @module
 * URL grammar for read/observe.
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
 * opaquely to the executing client.
 */

/**
 * Reserved built-in fn names. Anything else is provider-defined and
 * conventionally namespaced as `x-<ns>.<name>`.
 */
export const RESERVED_FNS = ["read", "ls", "count"] as const;
export type ReservedFn = typeof RESERVED_FNS[number];

/**
 * Synthetic-content namespace. The framework reserves `b3nd://` for
 * any uri it has to invent — `fn=count` answers, observe-batch
 * envelopes, cursors, errors, etc. There is no schema beyond the
 * namespace rule; protocols are free to add sub-paths.
 */
export const SYNTHETIC_NS = "b3nd://";

/**
 * Build the synthetic uri the executing client uses as the address of
 * a `fn=count` answer. The original request uri is preserved as the
 * tail so the answer is self-describing.
 */
export const countUri = (uri: string): string => `${SYNTHETIC_NS}count/${uri}`;

/**
 * Default synthetic uri for `observe` notification packages. Backends
 * may add `/<id>` or `/<pattern>` if they want to disambiguate
 * subscriptions.
 */
export const OBSERVE_URI: string = `${SYNTHETIC_NS}observe`;

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
 * bag (`ext`).
 */
export interface ParsedUrl {
  uri: string;
  fn: string;
  params: ReadParams;
  ext: Record<string, string>;
}

/**
 * Options accepted by the read-url helpers (`count`, `list`, ...).
 * Standard `ReadParams` plus an `ext` bag for `x-*` extensions.
 */
export type ReadOpts = ReadParams & { ext?: Record<string, string> };

/**
 * Parse a url into its identity, function, params, and extensions.
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

  return { uri, fn, params, ext };
}

/**
 * Serialize a parsed url back to its string form.
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

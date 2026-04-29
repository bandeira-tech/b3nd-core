/**
 * @module
 * HTTP API for the Rig.
 *
 * Standalone function that translates HTTP requests to rig method calls.
 * No framework dependency, no middleware — just a `(Request) => Promise<Response>`.
 *
 * The rig stays pure (orchestration only). Transport is external.
 *
 * Routes:
 *   GET  /api/v1/status            → rig.status()
 *   POST /api/v1/receive           → rig.receive([[uri, payload]])
 *   GET  /api/v1/read/:uri         → rig.read(uri)
 *   GET  /api/v1/observe/:pattern   → SSE stream from rig events
 *
 * @example
 * ```ts
 * import { Rig, connection } from "@b3nd/rig";
 * import { httpApi } from "@b3nd/rig/http";
 *
 * const c = connection(client, ["*"]);
 * const rig = new Rig({ routes: { receive: [c], read: [c], observe: [c] } });
 * Deno.serve({ port: 3000 }, httpApi(rig));
 * ```
 *
 * @example Hono (CORS, middleware, etc.)
 * ```ts
 * const api = httpApi(rig, { statusMeta: { version: "1.0" } });
 * const app = new Hono();
 * app.use("*", cors({ origin: "*" }));
 * app.all("/api/*", (c) => api(c.req.raw));
 * ```
 */

import { decodeBase64 } from "../b3nd-core/encoding.ts";
import type { Rig } from "./rig.ts";
import type { RigEvent } from "./events.ts";

// ── Types ──

export interface HttpApiOptions {
  /** Extra metadata merged into status responses. */
  statusMeta?: Record<string, unknown>;
}

// ── Binary deserialization ──

/** Unwrap base64-encoded binary marker objects back to Uint8Array. */
function deserializeBinary(data: unknown): unknown {
  if (
    data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).__b3nd_binary__ === true &&
    (data as Record<string, unknown>).encoding === "base64" &&
    typeof (data as Record<string, unknown>).data === "string"
  ) {
    return decodeBase64((data as Record<string, unknown>).data as string);
  }
  return data;
}

// ── URI helpers ──

/** Extract a b3nd URI from the request path after a prefix. */
function extractUri(path: string, prefix: string): string | null {
  // /api/v1/read/mutable/open/test → mutable://open/test
  // /api/v1/read/mutable/open/test/ → mutable://open/test/ (trailing slash preserved)
  const rest = path.slice(prefix.length);
  if (!rest) return null;
  const hasTrailingSlash = rest.endsWith("/");
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) {
    // protocol-only: /api/v1/read/mutable → mutable://
    return parts.length === 1 ? `${parts[0]}://` : null;
  }
  const protocol = parts[0];
  const domain = parts[1];
  const subpath = parts.slice(2).join("/");
  const uri = subpath
    ? `${protocol}://${domain}/${subpath}`
    : `${protocol}://${domain}`;
  return hasTrailingSlash ? `${uri}/` : uri;
}

/** Guess MIME type from URI file extension. */
function getMimeType(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff2: "font/woff2",
    woff: "font/woff",
    ttf: "font/ttf",
    pdf: "application/pdf",
    wasm: "application/wasm",
    ico: "image/x-icon",
    txt: "text/plain",
    xml: "application/xml",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}

// ── Responses ──

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── API factory ──

/**
 * Create an HTTP request handler backed by a Rig.
 *
 * Returns a standard `(Request) => Promise<Response>` — plug it
 * into Deno.serve, Hono, or any other HTTP framework.
 *
 * SSE subscriptions are powered by rig events — when `rig.receive()`
 * or `rig.send()` succeeds, SSE subscribers with matching prefixes
 * receive the event in real-time.
 *
 * @example
 * ```ts
 * import { Rig, connection } from "@b3nd/rig";
 * import { httpApi } from "@b3nd/rig/http";
 *
 * const c = connection(client, ["*"]);
 * const rig = new Rig({ routes: { receive: [c], read: [c], observe: [c] } });
 * const api = httpApi(rig);
 * Deno.serve({ port: 3000 }, api);
 * ```
 */
export function httpApi(
  rig: Rig,
  options?: HttpApiOptions,
): (req: Request) => Promise<Response> {
  const statusMeta = options?.statusMeta;

  // ── SSE subscriber tracking ──
  // Each subscriber has a prefix and a write function.
  type SseSubscriber = {
    prefix: string;
    prefixSegments: string[];
    write: (text: string) => void;
    closed: boolean;
  };
  const subscribers = new Set<SseSubscriber>();

  // Wire rig events to SSE subscribers
  const pushToSubscribers = (e: RigEvent) => {
    if (!e.uri || subscribers.size === 0) return;
    const event = { uri: e.uri, data: e.data, ts: e.ts };
    const payload = `id: ${e.ts}\nevent: write\ndata: ${
      JSON.stringify(event)
    }\n\n`;
    for (const sub of subscribers) {
      if (sub.closed) continue;
      // Prefix match — subscriber's prefix must be a prefix of the URI
      if (e.uri.startsWith(sub.prefix) || sub.prefix === "*") {
        sub.write(payload);
      }
    }
  };
  rig.on("receive:success", pushToSubscribers);
  rig.on("send:success", pushToSubscribers);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // ── Status (replaces health + schema) ──
    if (
      method === "GET" &&
      (path === "/api/v1/status" || path === "/api/v1/health")
    ) {
      const res = await rig.status();
      const body = statusMeta ? { ...res, ...statusMeta } : res;
      return json(body, res.status === "healthy" ? 200 : 503);
    }

    // ── Schema (derived from status) ──
    if (method === "GET" && path === "/api/v1/schema") {
      const res = await rig.status();
      return json({ schema: res.schema ?? [] });
    }

    // ── Receive ──
    if (method === "POST" && path === "/api/v1/receive") {
      let msg: unknown;
      try {
        msg = await req.json();
      } catch {
        return json(
          { accepted: false, error: "Invalid JSON body" },
          400,
        );
      }
      if (!Array.isArray(msg) || msg.length !== 2) {
        return json(
          { accepted: false, error: "Expected [uri, payload]" },
          400,
        );
      }
      const [uri, rawPayload] = msg as [unknown, unknown];
      if (!uri || typeof uri !== "string") {
        return json(
          { accepted: false, error: "URI is required" },
          400,
        );
      }
      const payload = deserializeBinary(rawPayload);
      // Pass the message through as-is. Decomposition is a protocol
      // concern (install messageDataProgram + messageDataHandler on the
      // Rig if you want envelope semantics); SimpleClient/DataStoreClient
      // never decompose on their own.
      const results = await rig.receive([[uri, payload]]);
      return json(results[0], results[0].accepted ? 200 : 400);
    }

    // ── Read ──
    // Supports both exact reads and trailing-slash list reads
    if (method === "GET" && path.startsWith("/api/v1/read/")) {
      const uri = extractUri(path, "/api/v1/read/");
      if (!uri) return json({ error: "Invalid URI" }, 400);

      const results = await rig.read(uri);

      // Trailing slash = list mode → return all results
      if (uri.endsWith("/")) {
        return json(results);
      }

      // Single read
      const res = results[0];
      if (!res?.success || !res.record) {
        return json({ error: res?.error || "Not found" }, 404);
      }
      // Binary data → raw bytes
      if (res.record.data instanceof Uint8Array) {
        return new Response(res.record.data as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": getMimeType(uri),
            "Content-Length": res.record.data.length.toString(),
          },
        });
      }
      return json(res.record);
    }

    // ── List (convenience alias for read with trailing slash) ──
    if (method === "GET" && path.startsWith("/api/v1/list/")) {
      const uri = extractUri(path, "/api/v1/list/");
      if (!uri) return json({ error: "Invalid URI" }, 400);
      const listUri = uri.endsWith("/") ? uri : `${uri}/`;
      const results = await rig.read(listUri);
      // Return as array of { uri, record } for backwards compat
      return json({
        success: true,
        data: results
          .filter((r) => r.success)
          .map((r) => ({ uri: r.uri, ...r.record })),
      });
    }

    // ── SSE Observe ──
    if (method === "GET" && path.startsWith("/api/v1/observe/")) {
      const uri = extractUri(path, "/api/v1/observe/");
      if (!uri) return json({ error: "Invalid URI" }, 400);

      const since = Number(url.searchParams.get("since") || "0");
      const lastEventId = req.headers.get("Last-Event-ID");
      const effectiveSince = lastEventId ? Number(lastEventId) : since;

      const sub: SseSubscriber = {
        prefix: uri,
        prefixSegments: uri.split("/"),
        write: () => {},
        closed: false,
      };

      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          sub.write = (text: string) => {
            if (sub.closed) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              sub.closed = true;
            }
          };
          subscribers.add(sub);

          // Send backlog (items since timestamp) via trailing-slash read
          (async () => {
            try {
              const listUri = uri.endsWith("/") ? uri : `${uri}/`;
              const results = await rig.read(listUri);
              for (const item of results) {
                if (sub.closed) break;
                if (!item.success || !item.record || !item.uri) continue;
                const now = Date.now();
                const event = {
                  uri: item.uri,
                  data: item.record.data,
                  ts: now,
                };
                sub.write(
                  `id: ${now}\nevent: write\ndata: ${
                    JSON.stringify(event)
                  }\n\n`,
                );
              }
            } catch {
              // Backlog failed — continue with live events
            }
          })();

          // Keep-alive ping
          const keepAlive = setInterval(() => {
            sub.write(": keepalive\n\n");
          }, 30_000);

          // Store cleanup for cancel
          (controller as unknown as { _cleanup: () => void })._cleanup = () => {
            sub.closed = true;
            subscribers.delete(sub);
            clearInterval(keepAlive);
          };
        },
        cancel(controller) {
          (controller as unknown as { _cleanup?: () => void })._cleanup?.();
          sub.closed = true;
          subscribers.delete(sub);
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── Not found ──
    return new Response("Not Found", { status: 404 });
  };
}

/**
 * HttpClient - HTTP implementation of ProtocolInterfaceNode
 *
 * Connects to B3nd HTTP API servers and forwards operations.
 * No schema validation - validation happens server-side.
 */

import type {
  HttpClientConfig,
  Message,
  Output,
  ProtocolInterfaceNode,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import { encodeBase64 } from "../b3nd-core/encoding.ts";
import { decodeBinaryFromJson } from "../b3nd-core/binary.ts";
import { routingKey } from "../b3nd-core/url.ts";
import { openSseStream } from "./sse.ts";

/**
 * Serialize message data for JSON transport.
 * Recursively wraps Uint8Array in a base64-encoded marker object to prevent
 * JSON corruption — handles binary data inside envelope outputs.
 */
function serializeMsgData(data: unknown): unknown {
  if (data instanceof Uint8Array) {
    return {
      __b3nd_binary__: true,
      encoding: "base64",
      data: encodeBase64(data),
    };
  }
  if (Array.isArray(data)) {
    return data.map(serializeMsgData);
  }
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      result[key] = serializeMsgData(val);
    }
    return result;
  }
  return data;
}

export class HttpClient implements ProtocolInterfaceNode {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;

  /** The base URL this client connects to. */
  readonly url: string;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, ""); // Remove trailing slash
    this.url = this.baseUrl;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make an HTTP request with timeout
   */
  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
          ...options.headers,
        },
        signal: controller.signal,
      });

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Receive a batch of messages (unified interface)
   * POSTs to /api/v1/receive endpoint
   * @param msgs - Array of Message tuples [uri, payload]
   * @returns ReceiveResult[] — one result per message
   */
  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    // Pre-validate URIs — return error results for invalid ones without sending
    const results: (ReceiveResult | null)[] = msgs.map(([uri]) => {
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Message URI is required" };
      }
      return null; // valid, will be sent
    });

    const validIndices: number[] = [];
    const validMsgs: Message[] = [];
    for (let i = 0; i < msgs.length; i++) {
      if (results[i] === null) {
        validIndices.push(i);
        validMsgs.push(msgs[i]);
      }
    }

    // If no valid messages, return the error results
    if (validMsgs.length === 0) {
      return results as ReceiveResult[];
    }

    try {
      const serializedBatch = JSON.stringify(
        validMsgs.map(([uri, payload]) => [uri, serializeMsgData(payload)]),
      );

      const response = await this.request("/api/v1/receive", {
        method: "POST",
        body: serializedBatch,
      });

      const serverResults: ReceiveResult[] = await response.json();

      if (!response.ok) {
        // Server returned an error — apply to all valid messages
        const errorMsg =
          (serverResults as unknown as { error?: string }).error ||
          response.statusText;
        for (const idx of validIndices) {
          results[idx] = { accepted: false, error: errorMsg };
        }
      } else {
        // Map server results back into the combined results array
        for (let j = 0; j < validIndices.length; j++) {
          results[validIndices[j]] = serverResults[j] ?? {
            accepted: false,
            error: "No result from server",
          };
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      for (const idx of validIndices) {
        results[idx] = { accepted: false, error: errorMsg };
      }
    }

    return results as ReceiveResult[];
  }

  async read<T = unknown>(urls: string[]): Promise<Output<T>[]> {
    if (urls.length === 0) return [];
    const response = await this.request("/api/v1/read", {
      method: "POST",
      body: JSON.stringify({ urls }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `HttpClient.read: ${response.status} ${response.statusText}${
          body ? `: ${body}` : ""
        }`,
      );
    }
    const body = await response.json() as Output<T>[];
    // Decode wire markers (binary + undefined) embedded in payloads.
    for (let i = 0; i < body.length; i++) {
      const [uri, payload] = body[i];
      body[i] = [uri, decodeBinaryFromJson(payload) as T];
    }
    return body;
  }

  async *observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<Output<string[]>> {
    if (urls.length === 0) return;

    // Open one SSE stream per url's routing key. The query string is
    // ignored — observe is INV-style and only the uri pattern matters.
    const queue: Output<string[]>[] = [];
    let wake: (() => void) | null = null;

    const forwarders = urls.map(async (url) => {
      const pattern = routingKey(url);
      // "mutable://data/market/*" → "mutable://data/market"
      const segments = pattern.split("/");
      const prefix = segments
        .filter((s) => !s.startsWith(":") && s !== "*")
        .join("/");
      const uriPath = prefix.replace("://", "/");
      const sseUrl = `${this.baseUrl}/api/v1/observe/${uriPath}`;
      try {
        for await (const event of openSseStream(sseUrl, { signal })) {
          if (signal.aborted) return;
          // Each SSE event carries one uri (or several, when the
          // server batches). Tag the package with the caller's input
          // url so consumers can route per subscription.
          const uris = Array.isArray(event.uris)
            ? (event.uris as string[])
            : typeof event.uri === "string"
            ? [event.uri]
            : [];
          if (uris.length === 0) continue;
          queue.push([url, uris]);
          const w = wake;
          if (w) {
            wake = null;
            w();
          }
        }
      } catch {
        // Per-stream errors are swallowed — one broken peer should
        // not tear down the merged stream.
      }
    });

    const onAbort = () => {
      const w = wake;
      if (w) {
        wake = null;
        w();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        while (queue.length > 0) yield queue.shift()!;
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      await Promise.allSettled(forwarders);
    }
  }

  async status(): Promise<StatusResult> {
    try {
      const response = await this.request("/api/v1/health", {
        method: "GET",
      });

      if (!response.ok) {
        return {
          status: "unhealthy",
          message: "Health check failed",
        };
      }

      const healthResult = await response.json();
      const status: StatusResult = {
        status: healthResult.status ?? "healthy",
        message: healthResult.message,
        details: healthResult.details,
      };
      if (Array.isArray(healthResult.fns)) status.fns = healthResult.fns;

      // Try to fetch schema info
      try {
        const schemaResponse = await this.request("/api/v1/schema", {
          method: "GET",
        });
        if (schemaResponse.ok) {
          const schemaResult = await schemaResponse.json();
          if (schemaResult.schema && Array.isArray(schemaResult.schema)) {
            status.schema = schemaResult.schema;
          }
        }
      } catch {
        // Schema endpoint optional — ignore errors
      }

      return status;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * HttpClient - HTTP implementation of ProtocolInterfaceNode
 *
 * Connects to B3nd HTTP API servers and forwards operations.
 * No schema validation - validation happens server-side.
 */

import type {
  HttpClientConfig,
  Message,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import { encodeBase64 } from "../b3nd-core/encoding.ts";
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
   * Parse URI into components
   * Example: "users://alice/profile" -> { protocol: "users", domain: "alice", path: "/profile" }
   */
  private parseUri(uri: string): {
    protocol: string;
    domain: string;
    path: string;
  } {
    const url = new URL(uri);
    return {
      protocol: url.protocol.replace(":", ""),
      domain: url.hostname,
      path: url.pathname,
    };
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

  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];

    // Batch optimization: use read-multi endpoint for multiple non-list URIs
    const listUris = uriList.filter((u) => u.endsWith("/"));
    const singleUris = uriList.filter((u) => !u.endsWith("/"));

    const results: ReadResult<T>[] = [];

    // Handle list URIs individually
    for (const uri of listUris) {
      results.push(...await this._list<T>(uri));
    }

    // Handle single URIs — use batch endpoint when multiple
    if (singleUris.length === 1) {
      results.push(await this._readOne<T>(singleUris[0]));
    } else if (singleUris.length > 1) {
      try {
        const response = await this.request("/api/v1/read-multi", {
          method: "POST",
          body: JSON.stringify({ uris: singleUris }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            // Consume the 404 body to avoid resource leaks
            await response.body?.cancel();
            // Fallback to individual reads if endpoint not available
            for (const uri of singleUris) {
              results.push(await this._readOne<T>(uri));
            }
          } else {
            await response.text();
            for (const uri of singleUris) {
              results.push({
                success: false,
                error: `Read failed: ${response.statusText}`,
              });
            }
          }
        } else {
          const batchResult = await response.json();
          // read-multi returns { results: [{ uri, success, record?, error? }] }
          if (batchResult.results && Array.isArray(batchResult.results)) {
            for (const item of batchResult.results) {
              if (item.success && item.record) {
                results.push({ success: true, record: item.record });
              } else {
                results.push({
                  success: false,
                  error: item.error || "Read failed",
                });
              }
            }
          }
        }
      } catch {
        // Fallback to individual reads on error
        for (const uri of singleUris) {
          results.push(await this._readOne<T>(uri));
        }
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const requestPath = `/api/v1/read/${protocol}/${domain}${path}`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        // Consume the response body to avoid leaks
        await response.text();
        if (response.status === 404) {
          return {
            success: false,
            error: "Not found",
          };
        }
        return {
          success: false,
          error: `Read failed: ${response.statusText}`,
        };
      }

      // Check Content-Type to determine if response is binary
      const contentType = response.headers.get("Content-Type") || "";
      const isBinary = contentType === "application/octet-stream" ||
        contentType.startsWith("image/") ||
        contentType.startsWith("audio/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("font/") ||
        contentType === "application/wasm";

      if (isBinary) {
        // Return binary data as Uint8Array
        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer) as unknown as T;
        return {
          success: true,
          record: { data },
        };
      }

      const record = await response.json();
      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async _list<T>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      // Use trailing-slash read endpoint — returns ReadResult[] directly,
      // avoiding the N+1 round-trip of the old /api/v1/list/ + re-fetch pattern.
      const trailingPath = path.endsWith("/") ? path : `${path}/`;
      const requestPath = `/api/v1/read/${protocol}/${domain}${trailingPath}`;

      const response = await this.request(requestPath, {
        method: "GET",
      });

      if (!response.ok) {
        await response.text();
        return [];
      }

      const results = await response.json();

      // Server returns ReadResult[] for trailing-slash reads
      if (Array.isArray(results)) {
        return results as ReadResult<T>[];
      }

      return [];
    } catch {
      return [];
    }
  }

  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Convert URI pattern to SSE endpoint path
    // "mutable://data/market/*" → strip :param and * → "mutable://data/market"
    // → "/api/v1/observe/mutable/data/market"
    const segments = pattern.split("/");
    const prefix = segments
      .filter((s) => !s.startsWith(":") && s !== "*")
      .join("/");
    const uriPath = prefix.replace("://", "/");
    const url = `${this.baseUrl}/api/v1/observe/${uriPath}`;

    for await (const event of openSseStream(url, { signal })) {
      if (signal.aborted) break;
      yield {
        success: true,
        uri: event.uri,
        record: { data: event.data as T },
      } as ReadResult<T>;
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

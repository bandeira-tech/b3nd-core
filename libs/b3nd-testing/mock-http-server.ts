/**
 * Mock HTTP Server for testing HttpClient
 *
 * Provides configurable HTTP server instances that simulate different scenarios:
 * - Happy path (successful operations)
 * - Connection errors (server unreachable)
 * - Validation errors (schema validation failures)
 */

import { decodeBase64 } from "../b3nd-core/encoding.ts";

/**
 * Deserialize message data from JSON transport.
 * Unwraps base64-encoded binary marker objects back to Uint8Array.
 */
function deserializeMsgData(data: unknown): unknown {
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

export interface MockServerConfig {
  /** Port to run server on */
  port: number;

  /** Behavior mode */
  mode: "happy" | "connectionError" | "validationError";

  /** In-memory storage for happy path */
  storage?: Map<string, { data: unknown }>;
}

export class MockHttpServer {
  private server?: Deno.HttpServer;
  private config: MockServerConfig;
  private storage: Map<string, { data: unknown }>;

  constructor(config: MockServerConfig) {
    this.config = config;
    this.storage = config.storage || new Map();
  }

  async start(): Promise<void> {
    if (this.config.mode === "connectionError") {
      // Don't actually start server for connection error mode
      return;
    }

    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Health endpoint
      if (url.pathname === "/api/v1/health") {
        return this.handleHealth();
      }

      // Schema endpoint
      if (url.pathname === "/api/v1/schema") {
        return this.handleSchema();
      }

      // Receive endpoint (unified message interface)
      if (url.pathname === "/api/v1/receive") {
        return await this.handleReceive(req);
      }

      // Read endpoint
      if (url.pathname.startsWith("/api/v1/read/")) {
        return this.handleRead(url);
      }

      // List endpoint
      if (url.pathname.startsWith("/api/v1/list/")) {
        return this.handleList(url);
      }

      return new Response("Not Found", { status: 404 });
    };

    // Create a promise that resolves when the server is actually listening
    let resolveListening: (() => void) | null = null;
    const listeningPromise = new Promise<void>((resolve) => {
      resolveListening = resolve;
    });

    this.server = Deno.serve({
      port: this.config.port,
      hostname: "127.0.0.1",
      onListen: () => {
        if (resolveListening) resolveListening();
      },
    }, handler);

    // Wait for the server to actually be listening
    await listeningPromise;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
    }
  }

  private handleHealth(): Response {
    return Response.json({
      status: "healthy",
      schema: ["store://"],
      message: "Mock server operational",
    });
  }

  private handleSchema(): Response {
    return Response.json({
      schema: ["store://"],
    });
  }

  private async handleReceive(req: Request): Promise<Response> {
    if (this.config.mode === "validationError") {
      return Response.json(
        [{ accepted: false, error: "Validation failed: Name is required" }],
        { status: 400 },
      );
    }

    // Parse batch of messages: Message[] = [uri, payload][]
    const msgs: unknown = await req.json();

    if (!msgs || !Array.isArray(msgs)) {
      return Response.json(
        [{
          accepted: false,
          error: "Invalid message format: expected Message[]",
        }],
        { status: 400 },
      );
    }

    const results: { accepted: boolean; error?: string }[] = [];

    for (const msg of msgs) {
      if (!Array.isArray(msg) || msg.length < 2) {
        results.push({
          accepted: false,
          error: "Invalid message: expected [uri, payload]",
        });
        continue;
      }

      const [msgUri, msgPayload] = msg;

      // Detect envelope format: { inputs: [...], outputs: [...] }
      const isEnvelope = msgPayload != null &&
        typeof msgPayload === "object" &&
        !Array.isArray(msgPayload) &&
        Array.isArray((msgPayload as Record<string, unknown>).inputs) &&
        Array.isArray((msgPayload as Record<string, unknown>).outputs);

      if (isEnvelope) {
        const { inputs, outputs } = msgPayload as {
          inputs: string[];
          outputs: unknown[][];
        };

        // Delete inputs
        for (const inputUri of inputs) {
          this.storage.delete(inputUri);
        }

        // Write outputs
        for (const output of outputs) {
          if (Array.isArray(output) && output.length >= 2) {
            const [outUri, outPayload] = output;
            const data = deserializeMsgData(outPayload);
            this.storage.set(outUri as string, {
              data,
            });
          }
        }
      } else {
        // Direct write — store payload at the message URI
        const data = deserializeMsgData(msgPayload);
        this.storage.set(msgUri as string, {
          data,
        });
      }

      results.push({ accepted: true });
    }

    return Response.json(results);
  }

  private handleRead(url: URL): Response {
    // Parse URI from path: /api/v1/read/{protocol}/{domain}{path}
    const hasTrailingSlash = url.pathname.endsWith("/");
    const parts = url.pathname.split("/").slice(4).filter(Boolean); // Skip /api/v1/read/
    const protocol = parts[0];
    const domain = parts[1];
    const subpath = parts.slice(2).join("/");
    const uri = subpath
      ? `${protocol}://${domain}/${subpath}`
      : `${protocol}://${domain}`;

    // Trailing slash = list mode → return ReadResult[] for all matching keys
    if (hasTrailingSlash) {
      const prefix = uri.endsWith("/") ? uri : uri;
      const results = Array.from(this.storage.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, record]) => ({
          success: true,
          uri: key,
          record,
        }));
      return Response.json(results);
    }

    const record = this.storage.get(uri);

    if (!record) {
      return new Response("Not found", { status: 404 });
    }

    // If data is binary (Uint8Array), return raw bytes with MIME type from URI
    if (record.data instanceof Uint8Array) {
      const mimeType = this.getMimeTypeFromUri(uri);
      return new Response(record.data as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": record.data.length.toString(),
        },
      });
    }

    return Response.json(record);
  }

  /**
   * Get MIME type from URI based on file extension
   */
  private getMimeTypeFromUri(uri: string): string {
    const MIME_TYPES: Record<string, string> = {
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      woff: "font/woff",
      woff2: "font/woff2",
      ttf: "font/ttf",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      wasm: "application/wasm",
      pdf: "application/pdf",
    };

    const path = uri.split("://").pop() || uri;
    const ext = path.split(".").pop()?.toLowerCase();
    return MIME_TYPES[ext || ""] || "application/octet-stream";
  }

  private handleList(url: URL): Response {
    // Parse URI from path: /api/v1/list/{protocol}/{domain}{path}
    const parts = url.pathname.split("/").slice(4); // Skip /api/v1/list/
    const protocol = parts[0];
    const domain = parts[1];
    const pathPart = parts.length > 2 ? "/" + parts.slice(2).join("/") : "";

    const prefix = `${protocol}://${domain}${pathPart}`;
    const pattern = url.searchParams.get("pattern");

    let items = Array.from(this.storage.keys())
      .filter((key) => key.startsWith(prefix))
      .map((uri) => ({
        uri,
      }));

    // Apply pattern filter if provided
    if (pattern) {
      items = items.filter((item) => item.uri.includes(pattern));
    }

    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");

    return Response.json({
      success: true,
      data: items.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total: items.length,
      },
    });
  }
}

/**
 * Create mock server instances for testing
 */
export async function createMockServers(): Promise<{
  happy: MockHttpServer;
  validationError: MockHttpServer;
  cleanup: () => Promise<void>;
}> {
  const sharedStorage = new Map<string, { data: unknown }>();

  const happy = new MockHttpServer({
    port: 8765,
    mode: "happy",
    storage: sharedStorage,
  });

  const validationError = new MockHttpServer({
    port: 8766,
    mode: "validationError",
  });

  await happy.start();
  await validationError.start();

  return {
    happy,
    validationError,
    cleanup: async () => {
      await happy.stop();
      await validationError.stop();
    },
  };
}

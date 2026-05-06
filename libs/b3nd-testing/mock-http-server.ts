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

      // Read endpoint (v2: batch POST with { urls: string[] })
      if (req.method === "POST" && url.pathname === "/api/v2/read") {
        return await this.handleReadV2(req);
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

  private async handleReadV2(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const urls = (body as { urls?: unknown })?.urls;
    if (!Array.isArray(urls) || !urls.every((u) => typeof u === "string")) {
      return Response.json(
        { error: "Expected { urls: string[] }" },
        { status: 400 },
      );
    }
    const out = (urls as string[]).flatMap((url) => this.readOne(url));
    return Response.json(out);
  }

  /**
   * Read one url. Supports the same fn dispatcher the real memory store
   * does: `fn=read` (default), `fn=ls` (with optional trailing slash on
   * the uri), `fn=count`. Anything else returns an unsupported error.
   */
  private readOne(url: string): unknown[] {
    const qIdx = url.indexOf("?");
    const uri = qIdx < 0 ? url : url.slice(0, qIdx);
    const params = new URLSearchParams(qIdx < 0 ? "" : url.slice(qIdx + 1));
    const explicit = params.get("fn");
    const fn = explicit ?? (uri.endsWith("/") ? "ls" : "read");

    if (fn === "read") {
      const record = this.storage.get(uri);
      if (!record) return [{ success: false, error: "Not found" }];
      const data = record.data instanceof Uint8Array
        ? {
          __b3nd_binary__: true,
          encoding: "base64",
          data: this.encodeB64(record.data),
        }
        : record.data;
      return [{ success: true, record: { data } }];
    }
    if (fn === "ls") {
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      const format = params.get("format") ?? "full";
      return Array.from(this.storage.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, record]) =>
          format === "uris"
            ? { success: true, uri: k }
            : { success: true, uri: k, record }
        );
    }
    if (fn === "count") {
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      const n = Array.from(this.storage.keys())
        .filter((k) => k.startsWith(prefix)).length;
      return [{ success: true, record: { data: n } }];
    }
    return [{ success: false, error: `unsupported fn '${fn}'` }];
  }

  private encodeB64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
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

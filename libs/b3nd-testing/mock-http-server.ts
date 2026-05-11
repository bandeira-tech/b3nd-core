/**
 * Mock HTTP Server for testing HttpClient.
 *
 * Acts as a wire-format adapter only — receive/read are delegated to a
 * `MemoryStore`. The mock owns:
 * - HTTP framing (routes, JSON encode/decode, status codes)
 * - The binary marker serialization that the real HTTP transport uses
 *   for `Uint8Array` payloads
 *
 * It does not re-implement read/ls/count semantics or answer-address
 * conventions — that's MemoryStore's job.
 *
 * Modes:
 * - `happy`               — fully functional
 * - `connectionError`     — server is never started
 * - `validationError`     — receive always rejects with a fixed error
 */

import { decodeBase64 } from "../b3nd-core/encoding.ts";
import { encodeBinaryForJson } from "../b3nd-core/binary.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";

/** Wire shape used to carry `Uint8Array` through JSON. */
interface BinaryMarker {
  __b3nd_binary__: true;
  encoding: "base64";
  data: string;
}

function isBinaryMarker(v: unknown): v is BinaryMarker {
  return v != null && typeof v === "object" &&
    (v as Record<string, unknown>).__b3nd_binary__ === true &&
    (v as Record<string, unknown>).encoding === "base64" &&
    typeof (v as Record<string, unknown>).data === "string";
}

function deserializeMsgData(data: unknown): unknown {
  return isBinaryMarker(data) ? decodeBase64(data.data) : data;
}

export interface MockServerConfig {
  /** Port to run server on */
  port: number;

  /** Behavior mode */
  mode: "happy" | "connectionError" | "validationError";

  /** Pre-built MemoryStore for sharing state across mocks. */
  store?: MemoryStore;
}

export class MockHttpServer {
  private server?: Deno.HttpServer;
  private config: MockServerConfig;
  private store: MemoryStore;

  constructor(config: MockServerConfig) {
    this.config = config;
    this.store = config.store ?? new MemoryStore();
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

      // Read endpoint — batch POST with `{ urls: string[] }`
      if (req.method === "POST" && url.pathname === "/api/v1/read") {
        return await this.handleRead(req);
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

        if (inputs.length > 0) {
          await this.store.delete(inputs);
        }

        const writeEntries: { uri: string; data: unknown }[] = [];
        for (const output of outputs) {
          if (Array.isArray(output) && output.length >= 2) {
            const [outUri, outPayload] = output;
            writeEntries.push({
              uri: outUri as string,
              data: deserializeMsgData(outPayload),
            });
          }
        }
        if (writeEntries.length > 0) await this.store.write(writeEntries);
      } else {
        // Direct write — store payload at the message URI
        await this.store.write([{
          uri: msgUri as string,
          data: deserializeMsgData(msgPayload),
        }]);
      }

      results.push({ accepted: true });
    }

    return Response.json(results);
  }

  private async handleRead(req: Request): Promise<Response> {
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
    const outputs = await this.store.read(urls as string[]);
    // Server-side wire encoding: walks the payload to encode binary
    // values as base64 markers and `undefined` as a sentinel so it
    // survives JSON. Matches the real `httpApi` server.
    return Response.json(
      outputs.map(([uri, data]) => [uri, encodeBinaryForJson(data)]),
    );
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
  const happy = new MockHttpServer({
    port: 8765,
    mode: "happy",
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

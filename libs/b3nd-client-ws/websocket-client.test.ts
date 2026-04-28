/**
 * WebSocketClient tests with proper mocking
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { WebSocketClient } from "./mod.ts";
import {
  runSharedSuite,
  type TestClientFactories,
} from "../b3nd-testing/shared-suite.ts";

/**
 * Mock WebSocket class that simulates WebSocket behavior without network
 */
class MockWebSocket {
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private storage: Map<string, any> = new Map();
  private timers: Set<number> = new Set();
  readyState: number;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(public url: string) {
    this.readyState = MockWebSocket.CONNECTING;
    // Simulate connection opening after a short delay
    const timer = setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent({ type: "open" });
    }, 10);
    this.timers.add(timer);
  }

  addEventListener(event: string, handler: (event: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: (event: any) => void) {
    this.listeners.get(event)?.delete(handler);
  }

  dispatchEvent(event: any) {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => handler(event));
    }
  }

  send(data: string) {
    // Simulate server response
    const timer = setTimeout(() => {
      try {
        const request = JSON.parse(data);
        const response = this.generateResponse(request);
        this.dispatchEvent({
          type: "message",
          data: JSON.stringify(response),
        });
      } catch (error) {
        this.dispatchEvent({
          type: "error",
          error: "Invalid request format",
        });
      }
    }, 5);
    this.timers.add(timer);
  }

  close(code?: number, reason?: string) {
    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent({ type: "close", code, reason });
  }

  protected generateResponse(request: any): any {
    const responses = {
      receive: () => {
        // Handle receive batch: payload is [[uri, payload], ...]
        const batch = request.payload as [string, unknown][];
        const results: { accepted: boolean; error?: string }[] = [];

        for (const [uri, msgPayload] of batch) {
          const envelope = msgPayload as
            | { inputs?: unknown; outputs?: unknown }
            | null;
          const isEnvelope = envelope != null &&
            typeof envelope === "object" &&
            Array.isArray(envelope.inputs) &&
            Array.isArray(envelope.outputs);

          if (isEnvelope) {
            for (const inputUri of envelope!.inputs as string[]) {
              this.storage.delete(inputUri);
            }
            for (
              const [outUri, outPayload] of envelope!.outputs as [
                string,
                unknown,
              ][]
            ) {
              this.storage.set(outUri, { data: outPayload });
            }
          } else {
            this.storage.set(uri, { data: msgPayload });
          }

          results.push({ accepted: true });
        }

        return {
          id: request.id,
          success: true,
          data: results,
        };
      },
      read: () => {
        // Client always sends { uris: [...] }
        const uris: string[] = request.payload.uris ?? [request.payload.uri];
        const allResults: any[] = [];

        for (const uri of uris) {
          if (uri.endsWith("/")) {
            // Trailing slash = list
            for (const [storedUri, stored] of this.storage) {
              if (storedUri.startsWith(uri)) {
                allResults.push({
                  success: true,
                  uri: storedUri,
                  record: { data: stored.data },
                });
              }
            }
          } else {
            const stored = this.storage.get(uri);
            if (stored) {
              allResults.push({
                success: true,
                uri,
                record: { data: stored.data },
              });
            } else {
              allResults.push({ success: false, uri, error: "Not found" });
            }
          }
        }

        return { id: request.id, success: true, data: allResults };
      },
      status: {
        id: request.id,
        success: true,
        data: {
          status: "healthy" as const,
          message: "WebSocket server is operational",
          schema: [],
          details: {
            connectedClients: 1,
          },
        },
      },
    };

    const responseGenerator = responses[request.type as keyof typeof responses];
    if (responseGenerator) {
      return typeof responseGenerator === "function"
        ? responseGenerator()
        : responseGenerator;
    } else {
      return {
        id: request.id,
        success: false,
        error: "Unknown request type",
      };
    }
  }
}

/**
 * Mock WebSocket implementation that replaces the global WebSocket
 */
function createMockWebSocketClient() {
  // Store original WebSocket
  const OriginalWebSocket = (globalThis as any).WebSocket;

  // Replace with mock
  (globalThis as any).WebSocket = MockWebSocket;

  return {
    restore: () => {
      (globalThis as any).WebSocket = OriginalWebSocket;
    },
  };
}

/**
 * Factory functions for shared test suite
 */
const factories: TestClientFactories = {
  happy: () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      reconnect: { enabled: false },
    });

    return client;
  },

  connectionError: () => {
    const mock = createMockWebSocketClient();

    // Create a mock that simulates connection failure
    class FailingMockWebSocket extends MockWebSocket {
      constructor(url: string) {
        super(url);
        // Override to simulate connection failure - never open the connection
        this.readyState = MockWebSocket.CLOSED;
      }

      override send(data: string) {
        // Simulate connection failure when trying to send
        setTimeout(() => {
          this.dispatchEvent({ type: "error", error: "Connection failed" });
          this.dispatchEvent({
            type: "close",
            code: 1006,
            reason: "Connection failed",
          });
        }, 5);
      }
    }

    (globalThis as any).WebSocket = FailingMockWebSocket;

    const client = new WebSocketClient({
      url: "ws://localhost:8766", // Different port
      reconnect: { enabled: false },
    });

    return client;
  },

  validationError: () => {
    const mock = createMockWebSocketClient();

    // Create a mock that simulates validation failure (rejects data without a name field)
    class ValidationFailingMockWebSocket extends MockWebSocket {
      protected override generateResponse(request: any): any {
        if (request.type === "receive") {
          const batch = request.payload as [string, unknown][];
          const results: { accepted: boolean; error?: string }[] = [];

          for (const [, data] of batch) {
            // Check output data for name field (handles both envelope and direct)
            const msgData = data as { outputs?: [string, unknown][] } | null;
            const outputData = msgData?.outputs?.[0]?.[1] as
              | Record<string, unknown>
              | undefined;
            const directData = data as Record<string, unknown> | null;

            if (outputData?.name || directData?.name) {
              results.push({ accepted: true });
            } else {
              results.push({ accepted: false, error: "Name is required" });
            }
          }

          return {
            id: request.id,
            success: true,
            data: results,
          };
        }
        return super.generateResponse(request);
      }
    }

    (globalThis as any).WebSocket = ValidationFailingMockWebSocket;

    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      reconnect: { enabled: false },
    });

    return client;
  },
};

/**
 * Run shared test suite
 */
runSharedSuite("WebSocketClient", factories);

/**
 * WebSocket-specific tests
 */
Deno.test({
  name: "WebSocketClient - connection management",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      reconnect: { enabled: false },
    });

    // Wait for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 50));

    // First operation should work
    const result = await client.receive([["users://test/data", {
      value: 123,
    }]]);
    assertEquals(result[0].accepted, true);

    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - reconnection configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        interval: 100,
        backoff: "linear",
      },
    });

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should work normally
    const result1 = await client.receive([["users://test/data", {
      value: 123,
    }]]);
    assertEquals(result1[0].accepted, true);

    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - authentication configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      auth: {
        type: "bearer",
        token: "test-token-123",
      },
      reconnect: { enabled: false },
    });

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should work with auth
    const result = await client.receive([["users://test/data", {
      value: 123,
    }]]);
    assertEquals(result[0].accepted, true);

    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - timeout configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: "ws://localhost:8765",
      timeout: 5000,
      reconnect: { enabled: false },
    });

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should work with custom timeout
    const result = await client.receive([["users://test/data", {
      value: 123,
    }]]);
    assertEquals(result[0].accepted, true);

    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

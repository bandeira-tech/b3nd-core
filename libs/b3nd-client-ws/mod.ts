/**
 * WebSocketClient - WebSocket implementation of ProtocolInterfaceNode
 *
 * Connects to B3nd WebSocket servers and forwards operations.
 * Handles reconnection and connection pooling.
 */

import type {
  Message,
  ObserveEvent,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";

export class WebSocketClient implements ProtocolInterfaceNode {
  private config: WebSocketClientConfig;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: WebSocketResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  // Active observe subscriptions. The server pushes `{ id, success: true,
  // data: { uri } }` per change and `{ id, success: true, data: null }` to
  // signal end-of-stream. Cancel: client sends `{ type: "observe-cancel" }`.
  private subscriptions = new Map<
    string,
    (frame: ObserveEvent | null) => void
  >();
  private messageHandler = this.handleMessage.bind(this);
  private closeHandler = this.handleClose.bind(this);
  private errorHandler = this.handleError.bind(this);

  constructor(config: WebSocketClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        interval: 1000,
        backoff: "exponential",
        ...config.reconnect,
      },
    };
  }

  /**
   * Ensure WebSocket connection is established
   */
  private ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      // Wait for connection to complete
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Connection timeout")),
          this.config.timeout,
        );

        const checkConnection = () => {
          if (this.connected) {
            clearTimeout(timeout);
            resolve();
          } else if (
            this.ws?.readyState === WebSocket.CLOSED ||
            this.ws?.readyState === WebSocket.CLOSING
          ) {
            clearTimeout(timeout);
            reject(new Error("Connection failed"));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    return this.connect();
  }

  /**
   * Establish WebSocket connection
   */
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const url = new URL(this.config.url);

        // Add auth to URL if needed
        if (this.config.auth) {
          switch (this.config.auth.type) {
            case "bearer":
              url.searchParams.set("token", this.config.auth.token || "");
              break;
            case "basic":
              url.username = this.config.auth.username || "";
              url.password = this.config.auth.password || "";
              break;
          }
        }

        this.ws = new WebSocket(url.toString());
        this.ws.addEventListener("open", () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        });
        this.ws.addEventListener("message", this.messageHandler);
        this.ws.addEventListener("close", this.closeHandler);
        this.ws.addEventListener("error", this.errorHandler);

        const timeout = setTimeout(() => {
          this.ws?.close();
          reject(new Error("Connection timeout"));
        }, this.config.timeout);

        // Clean up timeout on successful connection
        this.ws.addEventListener("open", () => clearTimeout(timeout), {
          once: true,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket messages
   */
  private handleMessage(event: MessageEvent) {
    try {
      const response: WebSocketResponse = JSON.parse(event.data);

      // Observe subscription: keep routing frames with the same id to
      // its callback until the server signals end-of-stream with
      // `data: null`.
      const sub = this.subscriptions.get(response.id);
      if (sub) {
        if (!response.success) {
          this.subscriptions.delete(response.id);
          sub(null);
          return;
        }
        if (response.data === null) {
          this.subscriptions.delete(response.id);
          sub(null);
        } else {
          sub(response.data as ObserveEvent);
        }
        return;
      }

      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose() {
    this.connected = false;
    this.cleanupPendingRequests(new Error("WebSocket connection closed"));

    if (
      this.config.reconnect?.enabled &&
      this.reconnectAttempts < (this.config.reconnect.maxAttempts || 5)
    ) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(_error: Event) {
    this.connected = false;
    this.cleanupPendingRequests(new Error("WebSocket error"));
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = this.config.reconnect?.backoff === "exponential"
      ? (this.config.reconnect.interval || 1000) *
        Math.pow(2, this.reconnectAttempts)
      : this.config.reconnect?.interval || 1000;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Connection failed, will retry if attempts remain
      });
    }, delay);
  }

  /**
   * Cleanup pending requests and subscriptions with error.
   */
  private cleanupPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    // Tear down active observe subscriptions.
    for (const sub of this.subscriptions.values()) {
      sub(null);
    }
    this.subscriptions.clear();
  }

  /**
   * Send request and wait for response
   */
  private async sendRequest<T>(
    type: WebSocketRequest["type"],
    payload: unknown,
  ): Promise<T> {
    await this.ensureConnected();

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: WebSocketRequest = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve(response.data as T);
          } else {
            reject(new Error(response.error || "Request failed"));
          }
        },
        reject,
        timeout,
      });

      try {
        this.ws?.send(JSON.stringify(request));
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Receive a batch of messages (unified interface)
   * Sends "receive" message type with encoded batch payload
   * @param msgs - Array of Message tuples [uri, payload]
   * @returns ReceiveResult[] — one result per message
   */
  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    try {
      const encodedMsgs = msgs.map((
        [uri, payload],
      ) => [uri, encodeBinaryForJson(payload)]);
      const results = await this.sendRequest<ReceiveResult[]>(
        "receive",
        encodedMsgs,
      );
      return results;
    } catch (error) {
      // On transport error, return error for every message in the batch
      const errorMsg = error instanceof Error ? error.message : String(error);
      return msgs.map(() => ({
        accepted: false,
        error: errorMsg,
      }));
    }
  }

  async read<T = unknown>(urls: string[]): Promise<ReadResult<T>[]> {
    if (urls.length === 0) return [];
    try {
      const results = await this.sendRequest<ReadResult<T>[]>("read", {
        urls,
      });
      const items = Array.isArray(results) ? results : [results];
      for (const item of items) {
        if (item.success && item.record) {
          item.record.data = decodeBinaryFromJson(item.record.data) as T;
        }
      }
      return items;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return urls.map(() => ({ success: false, error: msg }));
    }
  }

  async *observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<ObserveEvent> {
    if (urls.length === 0) return;
    await this.ensureConnected();

    const id = crypto.randomUUID();
    const queue: ObserveEvent[] = [];
    let wake: (() => void) | null = null;
    let ended = false;

    this.subscriptions.set(id, (frame) => {
      if (frame === null) {
        ended = true;
      } else {
        queue.push(frame);
      }
      const w = wake;
      if (w) {
        wake = null;
        w();
      }
    });

    const onAbort = () => {
      try {
        this.ws?.send(
          JSON.stringify({
            id,
            type: "observe-cancel",
            payload: {},
          } as WebSocketRequest),
        );
      } catch {
        // Ignore — connection may already be closed.
      }
      this.subscriptions.delete(id);
      const w = wake;
      if (w) {
        wake = null;
        w();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      this.ws!.send(
        JSON.stringify({
          id,
          type: "observe",
          payload: { urls },
        } as WebSocketRequest),
      );
      while (true) {
        while (queue.length > 0) yield queue.shift()!;
        if (signal.aborted || ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.subscriptions.delete(id);
    }
  }

  async status(): Promise<StatusResult> {
    try {
      const result = await this.sendRequest<StatusResult>("status", {});
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * ConsoleClient — a write-only debug/audit client.
 *
 * Logs receive (write) operations to stdout (or a custom logger).
 * Read always returns empty results — this client is for inspection, not retrieval.
 *
 * This is a transport-style client (like HttpClient, WebSocketClient) with
 * no underlying Store — it's a sink, not storage.
 *
 * @example
 * ```typescript
 * import { ConsoleClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new ConsoleClient("debug");
 *
 * await client.receive([["mutable://app/config", { theme: "dark" }]]);
 * // Console output: [debug] RECEIVE mutable://app/config data={"theme":"dark"}
 * ```
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";

/**
 * Safely serialize data for console output.
 * Falls back to a placeholder if JSON.stringify throws (circular refs, BigInt, etc.).
 */
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return "[unserializable]";
  }
}

export class ConsoleClient implements ProtocolInterfaceNode {
  private readonly label: string;
  private readonly log: (message: string) => void;

  constructor(label?: string, logger?: (msg: string) => void) {
    this.label = label ?? "b3nd";
    this.log = logger ?? console.log;
  }

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const [uri, payload] of msgs) {
      const payloadStr = safeStringify(payload);
      this.log(
        `[${this.label}] RECEIVE ${uri} payload=${payloadStr}`,
      );
      results.push({ accepted: true });
    }

    return results;
  }

  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    return Promise.resolve(
      uriList.map((uri) => ({
        success: false as const,
        error: "ConsoleClient is write-only",
      })),
    );
  }

  observe<T = unknown>(
    _pattern: string,
    _signal?: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.resolve({ value: undefined as any, done: true }),
        };
      },
    };
  }

  status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      message: "ConsoleClient is operational",
    });
  }
}

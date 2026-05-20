/**
 * ConsoleClient — a write-only debug/audit client.
 *
 * Logs receive (write) operations to stdout (or a custom logger).
 * Read always returns empty results — this client is for inspection, not retrieval.
 *
 * This is a transport-style client with no underlying Store — it's a sink,
 * not storage. (Compare to the HTTP / WebSocket clients in
 * `@bandeira-tech/b3nd-move`, which speak the same shape over the wire.)
 *
 * @example
 * ```typescript
 * import { ConsoleClient } from "@bandeira-tech/b3nd-core/client-console";
 *
 * const client = new ConsoleClient("debug");
 *
 * await client.receive([["mutable://app/config", { theme: "dark" }]]);
 * // Console output: [debug] RECEIVE mutable://app/config data={"theme":"dark"}
 * ```
 */

import type {
  Output,
  ProtocolInterfaceNode,
  ReceiveResult,
  StatusResult,
} from "../types/types.ts";

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

  receive(msgs: Output[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const [uri, payload] of msgs) {
      const payloadStr = safeStringify(payload);
      this.log(
        `[${this.label}] RECEIVE ${uri} payload=${payloadStr}`,
      );
      results.push({ accepted: true });
    }

    return Promise.resolve(results);
  }

  read<T = unknown>(_urls: string[]): Promise<Output<T>[]> {
    // ConsoleClient is write-only — every read produces no Output.
    return Promise.resolve([]);
  }

  observe(
    _urls: string[],
    _signal?: AbortSignal,
  ): AsyncIterable<readonly string[]> {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            Promise.resolve({
              value: undefined as unknown as readonly string[],
              done: true,
            }),
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

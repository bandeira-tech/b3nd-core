/**
 * @module
 * FunctionalClient - A client that takes functions as config.
 *
 * Replaces createNode() for cases where you want to wire up
 * custom behavior without class inheritance.
 */

import type {
  Message,
  ProtocolInterfaceNode,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "./types.ts";

/**
 * Configuration for FunctionalClient.
 * Each method is optional — missing methods return sensible defaults.
 */
export interface FunctionalClientConfig {
  receive?: (msgs: Message[]) => Promise<ReceiveResult[]>;
  read?: <T = unknown>(uris: string | string[]) => Promise<ReadResult<T>[]>;
  observe?: <T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ) => AsyncIterable<ReadResult<T>>;
  status?: () => Promise<StatusResult>;
}

/**
 * A client that delegates each method to a config function.
 *
 * If a method is not provided, it returns a sensible default:
 * - receive → { accepted: false, error: "not implemented" }
 * - read → [{ success: false, error: "not implemented" }] per URI
 * - status → { status: "healthy" }
 *
 * @example
 * ```typescript
 * const client = new FunctionalClient({
 *   receive: async (msg) => backend.receive(msg),
 *   read: async (uris) => backend.read(uris),
 * });
 * ```
 */
export class FunctionalClient implements ProtocolInterfaceNode {
  private config: FunctionalClientConfig;

  constructor(config: FunctionalClientConfig) {
    this.config = config;
  }

  receive(msgs: Message[]): Promise<ReceiveResult[]> {
    if (this.config.receive) {
      return this.config.receive(msgs);
    }
    return Promise.resolve(
      msgs.map(() => ({ accepted: false, error: "not implemented" })),
    );
  }

  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    if (this.config.read) {
      return this.config.read<T>(uris);
    }
    const uriList = Array.isArray(uris) ? uris : [uris];
    return Promise.resolve(
      uriList.map(() =>
        ({ success: false, error: "not implemented" }) as ReadResult<T>
      ),
    );
  }

  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    if (this.config.observe) {
      yield* this.config.observe<T>(pattern, signal);
    }
    // No observe config → empty stream (never yields)
  }

  status(): Promise<StatusResult> {
    if (this.config.status) {
      return this.config.status();
    }
    return Promise.resolve({ status: "healthy" });
  }
}

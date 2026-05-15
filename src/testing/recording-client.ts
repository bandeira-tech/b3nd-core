/**
 * RecordingClient — a `ProtocolInterfaceNode` test double that
 * records every method call into an in-memory log and returns
 * caller-supplied or sensible-default responses.
 *
 * Use this when a test cares about *what the framework dispatched*
 * (which methods, in what order, with what arguments) rather than
 * about a specific backend's behavior. Tests pin themselves to the
 * dispatch contract instead of accidentally depending on a backend's
 * particular semantics.
 *
 * @example
 * ```ts
 * import { RecordingClient } from "@bandeira-tech/b3nd-core/testing";
 *
 * const client = new RecordingClient({
 *   read: (urls) => urls.map((u): Output => [u, { hi: "there" }]),
 * });
 *
 * // … wire `client` into a rig, exercise the code under test …
 *
 * // Now assert on what the framework dispatched:
 * assertEquals(client.calls.length, 2);
 * assertEquals(client.callsOf("receive").length, 1);
 * assertEquals(client.callsOf("read")[0].urls, ["mutable://x"]);
 * ```
 */

import type {
  Message,
  Output,
  ProtocolInterfaceNode,
  ReceiveResult,
  StatusResult,
} from "../types/types.ts";

/** A single recorded invocation against a RecordingClient. */
export type RecordedCall =
  | { method: "receive"; msgs: Message[] }
  | { method: "read"; urls: string[] }
  | { method: "observe"; urls: string[] }
  | { method: "status" };

/** Map a recorded method name to its fully-typed call entry. */
export type RecordedCallOf<M extends RecordedCall["method"]> = Extract<
  RecordedCall,
  { method: M }
>;

/**
 * Optional canned responses for a RecordingClient. Any handler not
 * provided falls back to a sensible default:
 *
 * - `receive` → `{ accepted: true }` per message
 * - `read`    → `[url, undefined]` per url (miss, per the package-wide
 *               convention)
 * - `observe` → empty async iterable that closes on signal abort
 * - `status`  → `{ status: "healthy" }`
 */
export interface RecordingClientFixtures {
  receive?: (
    msgs: Message[],
  ) => ReceiveResult[] | Promise<ReceiveResult[]>;
  read?: (
    urls: string[],
  ) => Output[] | Promise<Output[]>;
  observe?: (
    urls: string[],
    signal: AbortSignal,
  ) => AsyncIterable<Output<string[]>>;
  status?: () => StatusResult | Promise<StatusResult>;
}

export class RecordingClient implements ProtocolInterfaceNode {
  readonly calls: RecordedCall[] = [];
  private fixtures: RecordingClientFixtures;

  constructor(fixtures: RecordingClientFixtures = {}) {
    this.fixtures = fixtures;
  }

  /** Empty the call log without changing fixtures. */
  reset(): void {
    this.calls.length = 0;
  }

  /** Convenience filter: all recorded calls of the given method. */
  callsOf<M extends RecordedCall["method"]>(method: M): RecordedCallOf<M>[] {
    return this.calls.filter((c): c is RecordedCallOf<M> =>
      c.method === method
    );
  }

  // ── ProtocolInterfaceNode impl ───────────────────────────────────

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    this.calls.push({ method: "receive", msgs });
    return this.fixtures.receive
      ? await this.fixtures.receive(msgs)
      : msgs.map(() => ({ accepted: true }));
  }

  async read<T = unknown>(urls: string[]): Promise<Output<T>[]> {
    this.calls.push({ method: "read", urls });
    const out = this.fixtures.read
      ? await this.fixtures.read(urls)
      : urls.map((u): Output => [u, undefined]);
    return out as Output<T>[];
  }

  observe(
    urls: string[],
    signal: AbortSignal,
  ): AsyncIterable<Output<string[]>> {
    this.calls.push({ method: "observe", urls });
    if (this.fixtures.observe) return this.fixtures.observe(urls, signal);
    // Default: an empty stream that resolves cleanly on abort. Test
    // code awaiting a `for await` loop on a default RecordingClient
    // hangs until something aborts the signal, then exits cleanly.
    // Implemented as a hand-rolled async iterator so the lint check
    // for `yield` in async generators doesn't trip on the empty body.
    return {
      [Symbol.asyncIterator](): AsyncIterator<Output<string[]>> {
        return {
          async next(): Promise<IteratorResult<Output<string[]>>> {
            if (signal.aborted) return { value: undefined, done: true };
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  async status(): Promise<StatusResult> {
    this.calls.push({ method: "status" });
    return this.fixtures.status
      ? await this.fixtures.status()
      : { status: "healthy" };
  }
}

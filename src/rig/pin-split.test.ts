/**
 * Type-contract assertions for the capability/discoverability split that
 * cannot be expressed as ordinary behavioral tests:
 *  - a node serving one verb is NOT assignable to another verb's route
 *    (a compile error, asserted via @ts-expect-error);
 *  - a full node still wires into every route (backward compatibility);
 *  - status() aggregates when only a single-verb node is wired — proving
 *    NodeStatus is the one contract every node must satisfy.
 *
 * The runtime "a receive-only node wires and dispatches" case is covered
 * organically by operation-handle.test.ts ("fires route:error when a
 * connection rejects"), which builds a receive-only node directly.
 */

import { assertEquals } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection, type Connection } from "./connection.ts";
import type {
  Output,
  ProtocolReadNode,
  ProtocolReceiveNode,
  ReceiveResult,
  StatusResult,
} from "../types/types.ts";

// Single-verb node doubles: each implements exactly one capability +
// status, with no stubs for the verbs it does not serve.
const receiver: ProtocolReceiveNode = {
  receive: (msgs: Output[]): Promise<ReceiveResult[]> =>
    Promise.resolve(msgs.map(() => ({ accepted: true }))),
  status: (): Promise<StatusResult> => Promise.resolve({ status: "healthy" }),
};

const reader: ProtocolReadNode = {
  read: <T = unknown>(locators: string[]): Promise<Output<T>[]> =>
    Promise.resolve(locators.map((l): Output<T> => [l, undefined as T])),
  status: (): Promise<StatusResult> => Promise.resolve({ status: "healthy" }),
};

// ── Compile-time guarantees (can't be runtime assertions) ──
//
// If the covariance ever loosened to allow either assignment, the
// directive below it would become an "unused directive" error and this
// file would fail to type-check — so these are load-bearing.

// A receive-only node must NOT satisfy a read-node connection.
// @ts-expect-error — a receive-only node is not a ProtocolReadNode
export const _badReadConn: Connection<ProtocolReadNode> = connection(
  receiver,
  ["**"],
);

// Symmetric: a read-only node must NOT satisfy a receive-node connection.
// @ts-expect-error — a read-only node is not a ProtocolReceiveNode
export const _badReceiveConn: Connection<ProtocolReceiveNode> = connection(
  reader,
  ["**"],
);

// ── Runtime: NodeStatus is the one contract every wired node satisfies ──

Deno.test("status() aggregates over a receive-only node", async () => {
  const rig = new Rig({ routes: { receive: [connection(receiver, ["**"])] } });
  const s = await rig.status();
  assertEquals(s.status, "healthy");
  assertEquals(s.resources?.receive, ["**"]);
});

// ── Backward compatibility: a full node still wires into every route ──

Deno.test("full node (Rig) wires into all three routes", () => {
  const inner = new Rig({
    routes: { receive: [connection(receiver, ["**"])] },
  });
  const c = connection(inner, ["**"]);
  const full = new Rig({ routes: { receive: [c], read: [c], observe: [c] } });
  assertEquals(typeof full.status, "function");
});

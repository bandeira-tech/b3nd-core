/**
 * Wire-level assertions for the capability/discoverability split:
 *  - a genuinely receive-only node ({ receive, status }) wires into
 *    routes.receive and works at runtime;
 *  - status() still aggregates when only a receive node is wired;
 *  - the same node is NOT assignable to a read route (compile error);
 *  - a full node (the Rig itself) still wires into all three routes.
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

// A genuinely receive-only node: `receive` + `status`, nothing else.
const receiver: ProtocolReceiveNode = {
  receive: (msgs: Output[]): Promise<ReceiveResult[]> =>
    Promise.resolve(msgs.map(() => ({ accepted: true }))),
  status: (): Promise<StatusResult> => Promise.resolve({ status: "healthy" }),
};

// A read-only node: `read` + `status`, nothing else.
const reader: ProtocolReadNode = {
  read: <T = unknown>(locators: string[]): Promise<Output<T>[]> =>
    Promise.resolve(locators.map((l): Output<T> => [l, undefined as T])),
  status: (): Promise<StatusResult> => Promise.resolve({ status: "healthy" }),
};

Deno.test("receive-only node wires into routes.receive and accepts", async () => {
  const rig = new Rig({ routes: { receive: [connection(receiver, ["**"])] } });
  const [r] = await rig.receive([["mutable://open/x", { v: 1 }]]);
  assertEquals(r.accepted, true);
});

Deno.test("status() aggregates over a receive-only node", async () => {
  const rig = new Rig({ routes: { receive: [connection(receiver, ["**"])] } });
  const s = await rig.status();
  assertEquals(s.status, "healthy");
  assertEquals(s.resources?.receive, ["**"]);
});

// A receive-only node must NOT satisfy a read-node connection. If the
// covariance ever loosened to allow this, the @ts-expect-error becomes
// an "unused directive" error and this file fails to type-check.
// @ts-expect-error — a receive-only node is not a ProtocolReadNode
export const _badReadConn: Connection<ProtocolReadNode> = connection(
  receiver,
  ["**"],
);

// A read-only node must NOT satisfy a receive-node connection. Symmetric
// to _badReadConn: proves neither direction of the asymmetry coerces.
// @ts-expect-error — a read-only node is not a ProtocolReceiveNode
export const _badReceiveConn: Connection<ProtocolReceiveNode> = connection(
  reader,
  ["**"],
);

Deno.test("full node (Rig) wires into all three routes", () => {
  const inner = new Rig({
    routes: { receive: [connection(receiver, ["**"])] },
  });
  const c = connection(inner, ["**"]);
  const full = new Rig({ routes: { receive: [c], read: [c], observe: [c] } });
  assertEquals(typeof full.status, "function");
});

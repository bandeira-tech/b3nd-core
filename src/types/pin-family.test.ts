/**
 * PIN family composition — compile-time assertions that
 * `ProtocolInterfaceNode` is assignable to each capability and node
 * type. If any type is missing or mis-composed, `deno test` fails to
 * type-check this file.
 */

import { assertEquals } from "@std/assert";
import type {
  NodeStatus,
  ProtocolInterfaceNode,
  ProtocolObserve,
  ProtocolObserveNode,
  ProtocolRead,
  ProtocolReadNode,
  ProtocolReceive,
  ProtocolReceiveNode,
} from "./types.ts";

// Each arrow asserts `ProtocolInterfaceNode <: <Target>` at compile time.
const asReceive = (n: ProtocolInterfaceNode): ProtocolReceive => n;
const asRead = (n: ProtocolInterfaceNode): ProtocolRead => n;
const asObserve = (n: ProtocolInterfaceNode): ProtocolObserve => n;
const asStatus = (n: ProtocolInterfaceNode): NodeStatus => n;
const asReceiveNode = (n: ProtocolInterfaceNode): ProtocolReceiveNode => n;
const asReadNode = (n: ProtocolInterfaceNode): ProtocolReadNode => n;
const asObserveNode = (n: ProtocolInterfaceNode): ProtocolObserveNode => n;

Deno.test("ProtocolInterfaceNode composes from the capability/node family", () => {
  // Referencing every binding satisfies noUnusedLocals; the real
  // assertions are the return-type annotations above.
  const family = [
    asReceive,
    asRead,
    asObserve,
    asStatus,
    asReceiveNode,
    asReadNode,
    asObserveNode,
  ];
  for (const f of family) assertEquals(typeof f, "function");
});

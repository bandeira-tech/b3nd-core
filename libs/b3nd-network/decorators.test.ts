/**
 * @module
 * Tests for peer decorators.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { ProtocolInterfaceNode, ReadResult } from "../b3nd-core/types.ts";
import { bestEffort } from "./decorators.ts";

function stub(
  overrides: Partial<ProtocolInterfaceNode> = {},
): ProtocolInterfaceNode {
  return {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: () => Promise.resolve([]),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" as const }),
    ...overrides,
  };
}

// ── bestEffort ───────────────────────────────────────────────────────

Deno.test("bestEffort swallows receive() errors and reports accepted", async () => {
  const inner = stub({
    receive: () => Promise.reject(new Error("peer offline")),
  });
  const wrapped = bestEffort(inner);

  const r = await wrapped.receive([["mutable://x/1", 1]]);
  assertEquals(r, [{ accepted: true }]);
});

Deno.test("bestEffort passes through successful receive unchanged", async () => {
  const calls: unknown[] = [];
  const inner = stub({
    receive: (msgs) => {
      calls.push(...msgs);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
  });
  const wrapped = bestEffort(inner);

  await wrapped.receive([["mutable://x/1", "payload"]]);
  assertEquals(calls.length, 1);
});

Deno.test("bestEffort passes through read unchanged", async () => {
  const inner = stub({
    read: <T>() =>
      Promise.resolve([{
        success: true,
        record: { data: "hit" as T },
      }] as ReadResult<T>[]),
  });
  const wrapped = bestEffort(inner);
  const r = await wrapped.read("mutable://x/1");
  assertEquals(r[0].record?.data, "hit");
});

Deno.test("bestEffort passes through observe unchanged (not a silent no-op)", async () => {
  // The old bestEffortClient swallowed observe — this test pins the fix.
  const inner: ProtocolInterfaceNode = {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: () => Promise.resolve([]),
    async *observe<T = unknown>() {
      yield {
        success: true,
        uri: "mutable://x/1",
        record: { data: 1 as T },
      } as ReadResult<T>;
    },
    status: () => Promise.resolve({ status: "healthy" as const }),
  };
  const wrapped = bestEffort(inner);

  const ac = new AbortController();
  const seen: string[] = [];
  for await (const r of wrapped.observe("*", ac.signal)) {
    if (r.uri) seen.push(r.uri);
    break;
  }
  assertEquals(seen, ["mutable://x/1"]);
});

Deno.test("bestEffort passes through status unchanged", async () => {
  const inner = stub({
    status: () => Promise.resolve({ status: "degraded", message: "busy" }),
  });
  const wrapped = bestEffort(inner);
  const s = await wrapped.status();
  assertEquals(s.status, "degraded");
  assertEquals(s.message, "busy");
});

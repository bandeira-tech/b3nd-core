/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert";
import { RecordingClient } from "./recording-client.ts";
import type { Output } from "../types/types.ts";

Deno.test("records receive calls with the message batch", async () => {
  const client = new RecordingClient();
  const results = await client.receive([
    ["mutable://a", 1],
    ["mutable://b", 2],
  ]);
  assertEquals(client.calls, [{
    method: "receive",
    msgs: [["mutable://a", 1], ["mutable://b", 2]],
  }]);
  // Default fixture: accepted: true per message.
  assertEquals(results, [{ accepted: true }, { accepted: true }]);
});

Deno.test("records read calls and returns miss-tuple by default", async () => {
  const client = new RecordingClient();
  const out = await client.read(["mutable://x", "mutable://y"]);
  assertEquals(client.calls, [{
    method: "read",
    urls: ["mutable://x", "mutable://y"],
  }]);
  assertEquals(out, [["mutable://x", undefined], ["mutable://y", undefined]]);
});

Deno.test("read fixture provides custom payloads", async () => {
  const client = new RecordingClient({
    read: (urls) => urls.map((u): Output => [u, u.toUpperCase()]),
  });
  const out = await client.read(["mutable://x"]);
  assertEquals(out, [["mutable://x", "MUTABLE://X"]]);
});

Deno.test("receive fixture overrides defaults", async () => {
  const client = new RecordingClient({
    receive: (msgs) =>
      msgs.map((_, i) =>
        i === 0 ? { accepted: false, error: "nope" } : { accepted: true }
      ),
  });
  const r = await client.receive([["a", 1], ["b", 2]]);
  assertEquals(r, [{ accepted: false, error: "nope" }, { accepted: true }]);
});

Deno.test("status returns healthy by default", async () => {
  const client = new RecordingClient();
  const s = await client.status();
  assertEquals(s, { status: "healthy" });
  assertEquals(client.calls, [{ method: "status" }]);
});

Deno.test("status fixture overrides default", async () => {
  const client = new RecordingClient({
    status: () => ({
      status: "degraded",
      message: "slow",
      fns: ["read"],
    }),
  });
  const s = await client.status();
  assertEquals(s, { status: "degraded", message: "slow", fns: ["read"] });
});

Deno.test("callsOf filters by method and preserves typing", async () => {
  const client = new RecordingClient();
  await client.receive([["a", 1]]);
  await client.read(["b"]);
  await client.receive([["c", 3]]);

  const receives = client.callsOf("receive");
  assertEquals(receives.length, 2);
  // Typed access: receives[0].msgs is Output[] without any cast.
  assertEquals(receives[0].msgs[0], ["a", 1]);

  const reads = client.callsOf("read");
  assertEquals(reads.length, 1);
  assertEquals(reads[0].urls, ["b"]);
});

Deno.test("reset clears the call log but not fixtures", async () => {
  const client = new RecordingClient({
    read: (urls) => urls.map((u): Output => [u, "v"]),
  });
  await client.read(["x"]);
  assertEquals(client.calls.length, 1);

  client.reset();
  assertEquals(client.calls.length, 0);

  // Fixture still applies after reset.
  const out = await client.read(["y"]);
  assertEquals(out, [["y", "v"]]);
});

Deno.test("default observe stream closes on signal abort", async () => {
  const client = new RecordingClient();
  const ac = new AbortController();
  const stream = client.observe(["mutable://watch"], ac.signal);

  assertEquals(client.calls, [{
    method: "observe",
    urls: ["mutable://watch"],
  }]);

  // Start consuming, then abort — the loop should exit cleanly.
  const consumed = (async () => {
    const items: (readonly string[])[] = [];
    for await (const item of stream) items.push(item);
    return items;
  })();

  // Defer abort so the consumer actually enters the await first.
  queueMicrotask(() => ac.abort());

  const items = await consumed;
  assertEquals(items, []);
});

Deno.test("observe respects already-aborted signal", async () => {
  const client = new RecordingClient();
  const ac = new AbortController();
  ac.abort();
  const stream = client.observe(["mutable://watch"], ac.signal);
  const items: (readonly string[])[] = [];
  for await (const item of stream) items.push(item);
  assertEquals(items, []);
});

Deno.test("observe fixture provides custom stream", async () => {
  const client = new RecordingClient({
    observe: async function* (_urls, _signal) {
      yield ["mutable://a", "mutable://b"];
    },
  });
  const ac = new AbortController();
  const stream = client.observe(["mutable://watch/"], ac.signal);
  const items: (readonly string[])[] = [];
  for await (const item of stream) items.push(item);
  assertEquals(items, [["mutable://a", "mutable://b"]]);
});

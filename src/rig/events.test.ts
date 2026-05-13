import { assertEquals } from "@std/assert";
import type { RigEvent } from "./events.ts";
import { RigEventEmitter } from "./events.ts";

Deno.test("RigEventEmitter - on fires handler", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  emitter.on("send:success", (e) => {
    received.push(e);
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  // Handlers fire via microtask — wait for them
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1);
  assertEquals(received[0].op, "send");
});

Deno.test("RigEventEmitter - on returns unsubscribe", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  const unsub = emitter.on("send:success", (e) => {
    received.push(e);
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1);

  unsub();

  emitter.emit("send:success", { op: "send", ts: 2 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1); // no new event
});

Deno.test("RigEventEmitter - off removes handler", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  const handler = (e: RigEvent) => {
    received.push(e);
  };
  emitter.on("read:success", handler);

  emitter.emit("read:success", { op: "read", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1);

  emitter.off("read:success", handler);

  emitter.emit("read:success", { op: "read", ts: 2 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1);
});

Deno.test("RigEventEmitter - wildcard *:success fires for all ops", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  emitter.on("*:success", (e) => {
    received.push(e);
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  emitter.emit("read:success", { op: "read", ts: 2 });
  emitter.emit("receive:error", { op: "receive", ts: 3 }); // not success

  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 2);
  assertEquals(received[0].op, "send");
  assertEquals(received[1].op, "read");
});

Deno.test("RigEventEmitter - wildcard *:error fires for all errors", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  emitter.on("*:error", (e) => {
    received.push(e);
  });

  emitter.emit("send:error", { op: "send", ts: 1 });
  emitter.emit("receive:error", { op: "receive", ts: 2 });
  emitter.emit("read:success", { op: "read", ts: 3 }); // not error

  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 2);
});

Deno.test("RigEventEmitter - handler errors are swallowed", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];

  // This handler throws
  emitter.on("send:success", () => {
    throw new Error("handler error");
  });
  // This handler should still fire
  emitter.on("send:success", (e) => {
    received.push(e);
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(received.length, 1); // second handler still ran
});

Deno.test("RigEventEmitter - multiple handlers for same event", async () => {
  const emitter = new RigEventEmitter();
  const calls: number[] = [];
  emitter.on("receive:success", () => {
    calls.push(1);
  });
  emitter.on("receive:success", () => {
    calls.push(2);
  });
  emitter.on("receive:success", () => {
    calls.push(3);
  });

  emitter.emit("receive:success", { op: "receive", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(calls, [1, 2, 3]);
});

Deno.test("RigEventEmitter - specific + wildcard both fire", async () => {
  const emitter = new RigEventEmitter();
  const calls: string[] = [];
  emitter.on("send:success", () => {
    calls.push("specific");
  });
  emitter.on("*:success", () => {
    calls.push("wildcard");
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(calls, ["specific", "wildcard"]);
});

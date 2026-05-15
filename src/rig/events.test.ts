import { assertEquals } from "@std/assert";
import type { RigEvent, RigEventName } from "./events.ts";
import { RigEventEmitter } from "./events.ts";

function captureWarn(): { warnings: unknown[][]; restore: () => void } {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  return { warnings, restore: () => (console.warn = original) };
}

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

Deno.test("RigEventEmitter - one handler throwing doesn't stop the others", async () => {
  const emitter = new RigEventEmitter();
  const received: RigEvent[] = [];
  const { warnings, restore } = captureWarn();

  try {
    emitter.on("send:success", () => {
      throw new Error("handler error");
    });
    emitter.on("send:success", (e) => {
      received.push(e);
    });

    emitter.emit("send:success", { op: "send", ts: 1 });
    await new Promise((r) => setTimeout(r, 10));

    assertEquals(received.length, 1); // sibling handler still ran
    assertEquals(warnings.length, 1); // error surfaced via console.warn fallback
  } finally {
    restore();
  }
});

Deno.test("RigEventEmitter - onHandlerError receives handler errors", async () => {
  const emitter = new RigEventEmitter();
  const seen: { error: unknown; event: RigEventName }[] = [];
  emitter.onHandlerError((error, event) => {
    seen.push({ error, event });
  });

  emitter.on("send:success", () => {
    throw new Error("boom");
  });

  emitter.emit("send:success", { op: "send", ts: 1 });
  await new Promise((r) => setTimeout(r, 10));

  assertEquals(seen.length, 1);
  assertEquals((seen[0].error as Error).message, "boom");
  assertEquals(seen[0].event, "send:success");
});

Deno.test("RigEventEmitter - onHandlerError suppresses console.warn fallback", async () => {
  const emitter = new RigEventEmitter();
  const { warnings, restore } = captureWarn();

  try {
    emitter.onHandlerError(() => {});
    emitter.on("send:success", () => {
      throw new Error("boom");
    });

    emitter.emit("send:success", { op: "send", ts: 1 });
    await new Promise((r) => setTimeout(r, 10));

    assertEquals(warnings.length, 0);
  } finally {
    restore();
  }
});

Deno.test("RigEventEmitter - onHandlerError unsubscribe restores fallback", async () => {
  const emitter = new RigEventEmitter();
  const { warnings, restore } = captureWarn();

  try {
    const unsub = emitter.onHandlerError(() => {});
    unsub();
    emitter.on("send:success", () => {
      throw new Error("boom");
    });

    emitter.emit("send:success", { op: "send", ts: 1 });
    await new Promise((r) => setTimeout(r, 10));

    assertEquals(warnings.length, 1);
  } finally {
    restore();
  }
});

Deno.test("RigEventEmitter - throwing onHandlerError listener falls back to warn, doesn't recurse", async () => {
  const emitter = new RigEventEmitter();
  const { warnings, restore } = captureWarn();

  try {
    emitter.onHandlerError(() => {
      throw new Error("listener boom");
    });
    emitter.on("send:success", () => {
      throw new Error("handler boom");
    });

    emitter.emit("send:success", { op: "send", ts: 1 });
    await new Promise((r) => setTimeout(r, 10));

    // Exactly one warn — from the secondary catch — proving no recursion.
    assertEquals(warnings.length, 1);
  } finally {
    restore();
  }
});

Deno.test("RigEventEmitter - pending() does not retain settled promises", async () => {
  // Regression: an earlier version pruned with `p.then(() => settled = true)`
  // and read `settled` synchronously, so the filter never dropped anything
  // and inflight grew unboundedly.
  const emitter = new RigEventEmitter();
  emitter.on("send:success", () => {});

  for (let i = 0; i < 200; i++) {
    emitter.emit("send:success", { op: "send", ts: i });
  }
  await new Promise((r) => setTimeout(r, 20));

  const pending = emitter.pending();
  assertEquals(pending.length, 0);
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

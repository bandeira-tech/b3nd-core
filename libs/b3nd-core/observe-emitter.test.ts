/**
 * ObserveEmitter Tests
 *
 * Direct unit tests on the listener + async-iterator primitive.
 *
 * These tests run without `noSanitize` — we want Deno's op and resource
 * sanitizers to flag any leaked timers, listeners, or pending promises.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { ObserveEmitter, type ObserveListener } from "./observe-emitter.ts";

/**
 * Test harness that exposes the protected internals so we can:
 *  - emit events synthetically (`emit`, `emitDeletes`)
 *  - inject a rogue listener (`installListener`) to exercise error paths
 *  - read listener count (`listenerCount`) to assert cleanup
 */
class Harness extends ObserveEmitter {
  emit(uri: string, data: unknown) {
    this._emit(uri, data);
  }
  emitDeletes(uris: string[]) {
    this._emitDeletes(uris);
  }
  installListener(l: ObserveListener) {
    this._listeners.add(l);
  }
  get listenerCount(): number {
    return this._listeners.size;
  }
}

// ── Basic matching ────────────────────────────────────────────────────

Deno.test("ObserveEmitter - yields on matching write", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: string[] = [];
  const done = (async () => {
    for await (const r of bus.observe("mutable://app/:key", ac.signal)) {
      if (r.uri) seen.push(r.uri);
      ac.abort();
    }
  })();

  await Promise.resolve(); // let the listener register
  bus.emit("mutable://app/x", "hello");
  await done;

  assertEquals(seen, ["mutable://app/x"]);
});

Deno.test("ObserveEmitter - deletes surface as data: null", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: {
    uri?: string;
    data: unknown;
  }[] = [];
  const done = (async () => {
    for await (const r of bus.observe("mutable://app/*", ac.signal)) {
      seen.push({
        uri: r.uri,
        data: r.record?.data,
      });
      ac.abort();
    }
  })();

  await Promise.resolve();
  bus.emitDeletes(["mutable://app/gone"]);
  await done;

  assertEquals(seen, [
    { uri: "mutable://app/gone", data: null },
  ]);
});

Deno.test("ObserveEmitter - payloads carry conserved quantities to the observer", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: unknown[] = [];
  const done = (async () => {
    for await (const r of bus.observe("tokens/:id", ac.signal)) {
      if (r.record) seen.push(r.record.data);
      ac.abort();
    }
  })();

  await Promise.resolve();
  // Conserved quantities live inside the payload now.
  bus.emit("tokens/42", { values: { fire: 100, water: 50 } });
  await done;

  assertEquals(seen, [{ values: { fire: 100, water: 50 } }]);
});

Deno.test("ObserveEmitter - non-matching URIs are ignored", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: string[] = [];
  const done = (async () => {
    for await (const r of bus.observe("mutable://app/:k", ac.signal)) {
      if (r.uri) seen.push(r.uri);
      ac.abort();
    }
  })();

  await Promise.resolve();
  bus.emit("mutable://other/x", 1); // does not match
  bus.emit("mutable://app/a", 2); // matches
  await done;

  assertEquals(seen, ["mutable://app/a"]);
});

Deno.test("ObserveEmitter - aborting terminates the iterator", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const done = (async () => {
    const seen: string[] = [];
    for await (const r of bus.observe("mutable://app/*", ac.signal)) {
      if (r.uri) seen.push(r.uri);
    }
    return seen;
  })();

  await Promise.resolve();
  ac.abort();
  const out = await done;
  assertEquals(out, []);
});

Deno.test("ObserveEmitter - multiple concurrent observers both receive", async () => {
  const bus = new Harness();
  const ac1 = new AbortController();
  const ac2 = new AbortController();

  const a: string[] = [];
  const b: string[] = [];
  const p1 = (async () => {
    for await (const r of bus.observe("mutable://app/:k", ac1.signal)) {
      if (r.uri) a.push(r.uri);
      ac1.abort();
    }
  })();
  const p2 = (async () => {
    for await (const r of bus.observe("mutable://app/:k", ac2.signal)) {
      if (r.uri) b.push(r.uri);
      ac2.abort();
    }
  })();

  await Promise.resolve();
  bus.emit("mutable://app/x", 1);
  await Promise.all([p1, p2]);

  assertEquals(a, ["mutable://app/x"]);
  assertEquals(b, ["mutable://app/x"]);
});

// ── Error isolation (real throw) ──────────────────────────────────────

Deno.test("ObserveEmitter - a throwing listener does not break other observers", async () => {
  const bus = new Harness();

  // Directly register a rogue listener that throws on every emit.
  // The bus must catch it and keep delivering to the well-behaved observer.
  let rogueCalls = 0;
  bus.installListener(() => {
    rogueCalls++;
    throw new Error("boom");
  });

  const ac = new AbortController();
  const seen: string[] = [];
  const done = (async () => {
    for await (const r of bus.observe("mutable://x/:k", ac.signal)) {
      if (r.uri) seen.push(r.uri);
      if (seen.length >= 2) ac.abort();
    }
  })();

  await Promise.resolve();
  bus.emit("mutable://x/a", 1); // rogue throws, well-behaved observer still sees
  bus.emit("mutable://x/b", 2);
  await done;

  assertEquals(seen, ["mutable://x/a", "mutable://x/b"]);
  assertEquals(rogueCalls, 2, "rogue listener was called on both emits");
});

// ── Queue across yield (the race that hung CI) ────────────────────────

Deno.test("ObserveEmitter - buffers events emitted before consumer loops back", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: string[] = [];
  const done = (async () => {
    for await (const r of bus.observe("k/:i", ac.signal)) {
      if (r.uri) seen.push(r.uri);
      // Simulate slow consumer work — forces additional microtask hops
      // between yields so buffering semantics are exercised.
      await Promise.resolve();
      await Promise.resolve();
      if (seen.length >= 5) ac.abort();
    }
  })();

  await Promise.resolve(); // listener registers
  // Burst 5 emits synchronously in a single tick — no awaits between them.
  // Without a per-iterator queue, only the first would be delivered; the
  // rest would fire while no listener was registered.
  for (let i = 0; i < 5; i++) bus.emit(`k/${i}`, i);

  await done;
  assertEquals(seen, ["k/0", "k/1", "k/2", "k/3", "k/4"]);
});

// ── Stress: many rapid emits ──────────────────────────────────────────

Deno.test("ObserveEmitter - 100 rapid emits arrive in order", async () => {
  const bus = new Harness();
  const ac = new AbortController();
  const N = 100;

  const seen: number[] = [];
  const done = (async () => {
    for await (const r of bus.observe("stress/:i", ac.signal)) {
      seen.push(r.record?.data as number);
      if (seen.length >= N) ac.abort();
    }
  })();

  await Promise.resolve();
  for (let i = 0; i < N; i++) bus.emit(`stress/${i}`, i);

  await done;
  assertEquals(seen.length, N);
  for (let i = 0; i < N; i++) assertEquals(seen[i], i);
});

// ── Abort semantics: drain queued events before exiting ───────────────

Deno.test("ObserveEmitter - buffered events drain before abort terminates the iterator", async () => {
  const bus = new Harness();
  const ac = new AbortController();

  const seen: string[] = [];
  const done = (async () => {
    for await (const r of bus.observe("q/:i", ac.signal)) {
      if (r.uri) seen.push(r.uri);
      // Do not abort here — we want the external abort to race with a
      // non-empty queue.
    }
  })();

  await Promise.resolve();
  // Buffer 3 events and abort synchronously in the same tick.
  bus.emit("q/1", 1);
  bus.emit("q/2", 2);
  bus.emit("q/3", 3);
  ac.abort();

  await done;
  // Current contract: queued events drain before the iterator honors abort.
  assertEquals(seen, ["q/1", "q/2", "q/3"]);
});

Deno.test("ObserveEmitter - abort before any emit yields nothing", async () => {
  const bus = new Harness();
  const ac = new AbortController();
  ac.abort(); // already aborted before observe() is called

  const seen: string[] = [];
  for await (const r of bus.observe("q/:i", ac.signal)) {
    if (r.uri) seen.push(r.uri);
  }
  assertEquals(seen, []);
});

// ── Listener leak sweep ───────────────────────────────────────────────

Deno.test("ObserveEmitter - 1000 create+abort cycles leave no listeners registered", async () => {
  const bus = new Harness();

  for (let i = 0; i < 1000; i++) {
    const ac = new AbortController();
    const it = bus.observe("leak/:k", ac.signal)[Symbol.asyncIterator]();
    // Prime the iterator so the generator registers its listener.
    const nextPromise = it.next();
    ac.abort();
    // Wait for the generator to unwind through the `finally` block.
    const r = await nextPromise;
    assertEquals(r.done, true);
  }

  assertEquals(
    bus.listenerCount,
    0,
    "every aborted observer must clean up its listener",
  );
});

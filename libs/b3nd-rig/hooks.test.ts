import { assertEquals, assertRejects } from "@std/assert";
import type { ReadCtx, ReceiveCtx } from "./hooks.ts";
import { resolveHooks, runAfter, runBefore } from "./hooks.ts";

// ── runBefore ──

Deno.test("runBefore - null hook passes through", async () => {
  const ctx: ReadCtx = { uri: "mutable://test" };
  const result = await runBefore(null, ctx);
  assertEquals(result, ctx);
});

Deno.test("runBefore - void return passes through", async () => {
  const ctx: ReadCtx = { uri: "mutable://test" };
  const result = await runBefore(() => {}, ctx);
  assertEquals(result, ctx);
});

Deno.test("runBefore - throw rejects operation", async () => {
  await assertRejects(
    () =>
      runBefore(
        () => {
          throw new Error("denied");
        },
        { uri: "mutable://test", data: {} },
      ),
    Error,
    "denied",
  );
});

Deno.test("runBefore - context replacement works", async () => {
  const result = await runBefore(
    (_ctx: ReadCtx) => ({
      ctx: { uri: "mutable://replaced" },
    }),
    { uri: "mutable://original" },
  );
  assertEquals(result.uri, "mutable://replaced");
});

Deno.test("runBefore - async hook works", async () => {
  await assertRejects(
    () =>
      runBefore(
        async () => {
          await new Promise((r) => setTimeout(r, 1));
          throw new Error("async deny");
        },
        { uri: "mutable://test" } as ReadCtx,
      ),
    Error,
    "async deny",
  );
});

// ── runAfter ──

Deno.test("runAfter - null hook completes", async () => {
  await runAfter(
    null,
    { uri: "mutable://test" } as ReadCtx,
    { success: true, record: { values: {}, data: "hello" } },
  );
  // no error = pass
});

Deno.test("runAfter - observer sees the result", async () => {
  const seen: unknown[] = [];
  await runAfter(
    (_ctx: ReadCtx, result: unknown) => {
      seen.push(result);
    },
    { uri: "mutable://test" },
    { success: true },
  );
  assertEquals(seen, [{ success: true }]);
});

Deno.test("runAfter - throw propagates to caller", async () => {
  await assertRejects(
    () =>
      runAfter(
        () => {
          throw new Error("post-condition violated");
        },
        { uri: "mutable://test" } as ReadCtx,
        { success: true },
      ),
    Error,
    "post-condition violated",
  );
});

Deno.test("runAfter - async hook works", async () => {
  let called = false;
  await runAfter(
    async () => {
      await new Promise((r) => setTimeout(r, 1));
      called = true;
    },
    { uri: "mutable://test" } as ReadCtx,
    { original: true },
  );
  assertEquals(called, true);
});

// ── resolveHooks ──

Deno.test("resolveHooks - frozen after creation", () => {
  const hooks = resolveHooks({
    beforeReceive: () => {},
  });

  // Frozen — mutations throw in strict mode
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    (hooks as any).beforeReceive = () => {};
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(typeof hooks.beforeReceive, "function");
});

Deno.test("resolveHooks - empty config gives all nulls", () => {
  const hooks = resolveHooks();
  assertEquals(hooks.beforeSend, null);
  assertEquals(hooks.afterSend, null);
  assertEquals(hooks.beforeReceive, null);
  assertEquals(hooks.afterReceive, null);
  assertEquals(hooks.beforeRead, null);
  assertEquals(hooks.afterRead, null);
});

import { assertEquals } from "@std/assert";
import { ReactionRegistry } from "./reactions.ts";
import type { Output, ReadFn } from "../types/types.ts";

// deno-lint-ignore no-explicit-any
const stubRead: ReadFn = (url) => Promise.resolve([url, undefined as any]);

// ── ReactionRegistry ──

Deno.test("ReactionRegistry - matches() returns reactions for matching URI", async () => {
  const registry = new ReactionRegistry();

  registry.add("mutable://app/users/*", (out) => {
    const id = out[0].split("/").pop()!;
    return Promise.resolve([
      [`audit://users/${id}`, { observed: true }] as Output,
    ]);
  });

  const matches = registry.matches("mutable://app/users/alice");
  assertEquals(matches.length, 1);
  assertEquals(matches[0].pattern, "mutable://app/users/*");

  const result = await matches[0].handler(
    ["mutable://app/users/alice", { name: "Alice" }],
    stubRead,
  );
  assertEquals(result, [["audit://users/alice", { observed: true }]]);
});

Deno.test("ReactionRegistry - no match returns empty array", () => {
  const registry = new ReactionRegistry();
  registry.add("mutable://app/users/*", () => Promise.resolve([]));

  const matches = registry.matches("mutable://app/posts/123");
  assertEquals(matches.length, 0);
});

Deno.test("ReactionRegistry - unsubscribe removes handler", () => {
  const registry = new ReactionRegistry();

  const unsub = registry.add(
    "mutable://app/config",
    () => Promise.resolve([]),
  );
  assertEquals(registry.matches("mutable://app/config").length, 1);

  unsub();
  assertEquals(registry.matches("mutable://app/config").length, 0);
});

Deno.test("ReactionRegistry - multiple patterns match same URI", () => {
  const registry = new ReactionRegistry();
  registry.add("mutable://app/users/*", () => Promise.resolve([]));
  registry.add("mutable://app/**", () => Promise.resolve([]));

  const matches = registry.matches("mutable://app/users/alice");
  assertEquals(matches.length, 2);
});

Deno.test("ReactionRegistry - size tracks entries", () => {
  const registry = new ReactionRegistry();
  assertEquals(registry.size, 0);

  const unsub = registry.add(
    "mutable://app/key",
    () => Promise.resolve([]),
  );
  assertEquals(registry.size, 1);

  registry.add("mutable://app/other", () => Promise.resolve([]));
  assertEquals(registry.size, 2);

  unsub();
  assertEquals(registry.size, 1);
});

Deno.test("ReactionRegistry - rejects :param patterns at registration", () => {
  const registry = new ReactionRegistry();
  let threw = false;
  try {
    registry.add(":id", () => Promise.resolve([]));
  } catch (e) {
    threw = e instanceof TypeError;
  }
  assertEquals(threw, true);
});

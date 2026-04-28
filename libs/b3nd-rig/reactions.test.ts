import { assertEquals } from "@std/assert";
import { matchPattern, ReactionRegistry } from "./reactions.ts";
import type { Output, ReadFn } from "../b3nd-core/types.ts";

const stubRead: ReadFn = () =>
  Promise.resolve({ success: false, error: "stub" });

// ── matchPattern ──

Deno.test("matchPattern - exact match", () => {
  const segments = "mutable://app/config".split("/");
  assertEquals(matchPattern(segments, "mutable://app/config"), {});
  assertEquals(matchPattern(segments, "mutable://app/other"), null);
});

Deno.test("matchPattern - :param captures segment", () => {
  const segments = "mutable://app/users/:id".split("/");
  assertEquals(
    matchPattern(segments, "mutable://app/users/alice"),
    { id: "alice" },
  );
  assertEquals(
    matchPattern(segments, "mutable://app/users/bob"),
    { id: "bob" },
  );
  assertEquals(matchPattern(segments, "mutable://app/users"), null);
  assertEquals(
    matchPattern(segments, "mutable://app/users/alice/extra"),
    null,
  );
});

Deno.test("matchPattern - multiple :params", () => {
  const segments = "mutable://app/:org/users/:id".split("/");
  assertEquals(
    matchPattern(segments, "mutable://app/acme/users/alice"),
    { org: "acme", id: "alice" },
  );
});

Deno.test("matchPattern - * wildcard matches rest", () => {
  const segments = "hash://sha256/*".split("/");
  assertEquals(
    matchPattern(segments, "hash://sha256/abc123"),
    { "*": "abc123" },
  );
  assertEquals(
    matchPattern(segments, "hash://sha256/abc/def"),
    { "*": "abc/def" },
  );
});

Deno.test("matchPattern - protocol mismatch", () => {
  const segments = "mutable://app/key".split("/");
  assertEquals(matchPattern(segments, "immutable://app/key"), null);
});

Deno.test("matchPattern - empty segments", () => {
  const segments = "mutable:".split("/");
  assertEquals(matchPattern(segments, "mutable:"), {});
});

// ── ReactionRegistry ──

Deno.test("ReactionRegistry - matches() returns reactions for matching URI", async () => {
  const registry = new ReactionRegistry();

  registry.add("mutable://app/users/:id", (_out, _read, params) => {
    return Promise.resolve([
      [`audit://users/${params.id}`, { observed: true }] as Output,
    ]);
  });

  const matches = registry.matches("mutable://app/users/alice");
  assertEquals(matches.length, 1);
  assertEquals(matches[0].params, { id: "alice" });

  const result = await matches[0].handler(
    ["mutable://app/users/alice", { name: "Alice" }],
    stubRead,
    matches[0].params,
  );
  assertEquals(result, [["audit://users/alice", { observed: true }]]);
});

Deno.test("ReactionRegistry - no match returns empty array", () => {
  const registry = new ReactionRegistry();
  registry.add("mutable://app/users/:id", () => Promise.resolve([]));

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
  registry.add("mutable://app/users/:id", () => Promise.resolve([]));
  registry.add("mutable://app/*", () => Promise.resolve([]));

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

import { assertEquals, assertThrows } from "@std/assert";
import { compilePattern, matches } from "./match-pattern.ts";

// ── Compile path 1: pure literal (no metas) ──

Deno.test("literal - exact match succeeds", () => {
  assertEquals(matches("mutable://app/config", "mutable://app/config"), true);
});

Deno.test("literal - different URI fails", () => {
  assertEquals(matches("mutable://app/config", "mutable://app/other"), false);
});

Deno.test("literal - is case-sensitive", () => {
  assertEquals(matches("mutable://APP", "mutable://app"), false);
});

Deno.test("literal - empty pattern only matches empty URI", () => {
  assertEquals(matches("", ""), true);
  assertEquals(matches("", "a"), false);
});

Deno.test("literal - protocol mismatch fails", () => {
  assertEquals(matches("mutable://app", "immutable://app"), false);
});

Deno.test("literal - trailing-slash mismatch fails", () => {
  assertEquals(matches("a/b", "a/b/"), false);
  assertEquals(matches("a/b/", "a/b"), false);
});

// ── Compile path 2: trailing ** only ──

Deno.test("** alone - matches anything (including empty)", () => {
  const m = compilePattern("**");
  assertEquals(m(""), true);
  assertEquals(m("anything"), true);
  assertEquals(m("a/b/c"), true);
});

Deno.test("**-suffix - matches URIs with the prefix", () => {
  const m = compilePattern("mutable://**");
  assertEquals(m("mutable://"), true);
  assertEquals(m("mutable://x"), true);
  assertEquals(m("mutable://app/users/alice"), true);
});

Deno.test("**-suffix - rejects URIs without the prefix", () => {
  const m = compilePattern("mutable://**");
  assertEquals(m("immutable://x"), false);
  assertEquals(m("mutable:/x"), false); // missing second slash
  assertEquals(m("mutable:"), false);
});

Deno.test("**-suffix - prefix is exact bytes", () => {
  const m = compilePattern("hash://sha256/**");
  assertEquals(m("hash://sha256/abc"), true);
  assertEquals(m("hash://sha256/a/b/c"), true);
  assertEquals(m("hash://sha512/abc"), false);
});

// ── Compile path 3: regex (single * or mixed) ──

Deno.test("* segment - matches exactly one non-empty segment", () => {
  const m = compilePattern("mutable://app/*");
  assertEquals(m("mutable://app/alice"), true);
  assertEquals(m("mutable://app/bob"), true);
});

Deno.test("* segment - rejects multi-segment match", () => {
  const m = compilePattern("mutable://app/*");
  assertEquals(m("mutable://app/alice/extra"), false);
});

Deno.test("* segment - rejects missing segment", () => {
  const m = compilePattern("mutable://app/*");
  assertEquals(m("mutable://app"), false);
  assertEquals(m("mutable://app/"), false); // empty segment doesn't match *
});

Deno.test("multiple * segments - each captures one segment", () => {
  const m = compilePattern("mutable://app/*/users/*");
  assertEquals(m("mutable://app/acme/users/alice"), true);
  assertEquals(m("mutable://app/zeta/users/bob"), true);
  assertEquals(m("mutable://app/acme/users/alice/extra"), false);
  assertEquals(m("mutable://app/acme/users"), false);
});

Deno.test("* followed by ** - captures one then rest", () => {
  const m = compilePattern("mutable://*/data/**");
  assertEquals(m("mutable://acme/data/x"), true);
  assertEquals(m("mutable://acme/data/x/y/z"), true);
  assertEquals(m("mutable://acme/data/"), true); // ** allows empty
  assertEquals(m("mutable://data/x"), false); // missing the * segment
});

Deno.test("regex path - escapes regex metacharacters in literal text", () => {
  // `.` and `?` must not be treated as regex specials.
  const m = compilePattern("a.b/*");
  assertEquals(m("a.b/x"), true);
  assertEquals(m("axb/x"), false);
});

// ── Grammar rejections ──

Deno.test("rejects :param segments", () => {
  assertThrows(() => compilePattern(":id"), TypeError);
  assertThrows(() => compilePattern("mutable://app/users/:id"), TypeError);
  assertThrows(() => compilePattern("a/:b/c"), TypeError);
});

Deno.test("rejects * mixed with other chars in a segment", () => {
  assertThrows(() => compilePattern("abc*"), TypeError);
  assertThrows(() => compilePattern("*abc"), TypeError);
  assertThrows(() => compilePattern("a/abc*/b"), TypeError);
});

Deno.test("rejects ** not as the final segment", () => {
  assertThrows(() => compilePattern("**/x"), TypeError);
  assertThrows(() => compilePattern("a/**/b"), TypeError);
});

Deno.test("rejects ** mixed with other chars in a segment", () => {
  assertThrows(() => compilePattern("**abc"), TypeError);
  assertThrows(() => compilePattern("abc**"), TypeError);
});

// ── Allowed quirks ──

Deno.test("allows literal `:` mid-segment", () => {
  // `mutable:` ends with `:`, but it's not at segment-start so it's literal.
  const m = compilePattern("mutable://app");
  assertEquals(m("mutable://app"), true);
});

Deno.test("allows literal segment with a `:` inside", () => {
  // Not at segment-start → literal segment.
  const m = compilePattern("a:b/c");
  assertEquals(m("a:b/c"), true);
  assertEquals(m("a/b/c"), false);
});

// ── compilePattern stability ──

Deno.test("compilePattern returns a reusable matcher", () => {
  const m = compilePattern("mutable://**");
  assertEquals(m("mutable://x"), true);
  assertEquals(m("mutable://y/z"), true);
  assertEquals(m("hash://x"), false);
});

// ── matches() one-shot ──

Deno.test("matches() compiles and runs in one call", () => {
  assertEquals(matches("a/**", "a/b/c"), true);
  assertEquals(matches("a/**", "b/c"), false);
});

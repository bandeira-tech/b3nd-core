/**
 * @module
 * URI pattern matching — shared by the rig (routing, reactions) and the
 * observe emitter.
 *
 * Grammar (segments separated by `/`):
 * - **literal** segments must match exactly.
 * - `*` matches **exactly one** non-empty segment.
 * - `**` matches **zero or more** remaining segments. Only valid as a
 *   complete final segment.
 *
 * Patterns compile to a closure once; the closure is called per URI.
 * Three compile paths, picked at compile time:
 *
 *   1. **Pure literal** (no metas)  → `(uri) => uri === pattern`
 *   2. **Trailing `**` only**       → `(uri) => uri.startsWith(prefix)`
 *   3. **Has a `*` somewhere**      → compiled `RegExp`, matched via `test`.
 *
 * Captures are intentionally not exposed. Callers that need a segment
 * value extract it from the URI directly (split on `/`, pick the index).
 * Keeping the matcher bool-only collapses three callers — routing,
 * observe, reactions — onto one fast path with no allocations.
 */

/** A compiled pattern: takes a URI, returns whether it matches. */
export type Matcher = (uri: string) => boolean;

/**
 * Compile a pattern string into a matcher closure.
 *
 * Throws `TypeError` on grammar violations:
 * - `:param`-style segments (legacy; use `*` and extract from the URI).
 * - `*` mixed into a segment with other chars (e.g. `abc*`, `*abc`).
 * - `**` not as a complete final segment (e.g. `** /x`, `a/** b`).
 *
 * @example
 * ```ts
 * const m = compilePattern("mutable://**");
 * m("mutable://users/alice"); // true
 * m("hash://abc");            // false
 * ```
 */
export function compilePattern(pattern: string): Matcher {
  const analysis = analyze(pattern);

  if (analysis.kind === "literal") {
    return (uri) => uri === pattern;
  }

  if (analysis.kind === "prefix") {
    const prefix = analysis.prefix;
    return (uri) => uri.startsWith(prefix);
  }

  const re = analysis.re;
  return (uri) => re.test(uri);
}

/**
 * One-shot matcher. Compiles the pattern every call — fine for ad-hoc
 * use; prefer `compilePattern` for anything hot.
 */
export function matches(pattern: string, uri: string): boolean {
  return compilePattern(pattern)(uri);
}

// ── Internals ──

type Analysis =
  | { kind: "literal" }
  | { kind: "prefix"; prefix: string }
  | { kind: "regex"; re: RegExp };

/**
 * Walk the pattern once, segment-aware:
 *  - reject `:foo` segments (legacy capture syntax),
 *  - reject mixed-meta segments like `abc*` or `**x`,
 *  - detect a trailing `**` for the `startsWith` fast path,
 *  - detect any `*` to switch to the regex path.
 */
function analyze(pattern: string): Analysis {
  const len = pattern.length;
  let hasSingleStar = false;
  let trailingDoubleStarAt = -1;

  let segStart = 0;
  for (let i = 0; i <= len; i++) {
    if (i === len || pattern.charCodeAt(i) === 47 /* / */) {
      const seg = pattern.slice(segStart, i);
      classifySegment(seg, i === len);

      if (seg === "**") {
        if (i !== len) {
          // `**` only valid as the last segment.
          throw new TypeError(
            `pattern "${pattern}": "**" must be the final segment`,
          );
        }
        // Position of the `**` in the original string (segStart).
        trailingDoubleStarAt = segStart;
      } else if (seg === "*") {
        hasSingleStar = true;
      }

      segStart = i + 1;
    }
  }

  if (!hasSingleStar && trailingDoubleStarAt < 0) {
    return { kind: "literal" };
  }

  if (!hasSingleStar && trailingDoubleStarAt >= 0) {
    // Strip the trailing `**` (and the `/` before it, if any).
    // segStart for `**` is the char *after* the leading `/`, so
    // `pattern.slice(0, trailingDoubleStarAt)` keeps the trailing `/`.
    return { kind: "prefix", prefix: pattern.slice(0, trailingDoubleStarAt) };
  }

  return { kind: "regex", re: toRegex(pattern) };
}

function classifySegment(seg: string, _isLast: boolean): void {
  if (seg === "*" || seg === "**" || !seg.includes("*")) {
    if (seg.startsWith(":")) {
      throw new TypeError(
        `pattern segment ":${seg.slice(1)}": ":param" syntax was removed; ` +
          `use "*" and extract the value from the URI`,
      );
    }
    return;
  }
  // Segment contains `*` mixed with other chars (e.g. `abc*`, `*x`, `a**b`).
  throw new TypeError(
    `pattern segment "${seg}": "*" and "**" must be complete segments`,
  );
}

/** Build a regex from a pattern containing `*` (and optionally trailing `**`). */
function toRegex(pattern: string): RegExp {
  // Replace meta segments with placeholders that survive escaping, then
  // escape, then swap placeholders for their regex equivalents.
  //
  // `*`  (full segment) → `[^/]+`   (one non-empty segment)
  // `**` (trailing seg) → `.*`      (zero or more remaining chars; the
  //                                  leading `/` before `**` is preserved
  //                                  by the surrounding pattern when the
  //                                  pattern has more than one segment,
  //                                  and absent when `**` is the whole
  //                                  pattern — both fall out naturally).
  const ONE = "\x00ONE\x00";
  const REST = "\x00REST\x00";

  // Tokenize on `/` so we only swap full-segment metas.
  const swapped = pattern
    .split("/")
    .map((seg) => seg === "*" ? ONE : seg === "**" ? REST : seg)
    .join("/");

  const escaped = swapped.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  const body = escaped
    .replaceAll(ONE, "[^/]+")
    .replaceAll(REST, ".*");

  return new RegExp(`^${body}$`);
}

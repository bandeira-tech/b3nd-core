/**
 * @module
 * Acceptance — the canonical "does this route accept this URI?" primitive.
 *
 * The framework only asks one thing of a route's filter: does this URI
 * belong on this connection? `Acceptance` is the typed shape of that
 * question. Pattern lists, prefixes, schema sets, and arbitrary
 * predicates are all just implementations of the same interface.
 *
 * `describe()` is the optional serializable form. Use it when a
 * connection's filter needs to be published over the wire so a remote
 * node can pre-filter what it sends (e.g. `flood`, sync policies). When
 * `describe` is omitted the filter is **local-only** — it still gates
 * dispatch in this rig, but remote nodes have no way to honor it.
 *
 * The recommended wire form is `string[]` (the pattern list shape used
 * across b3nd). Acceptances that produce richer descriptors are fine
 * for local routing but should not assume remote enforcement.
 */

import { matchPattern } from "../match-pattern/match-pattern.ts";

// ── Core primitive ────────────────────────────────────────────────

/**
 * Acceptance — predicate over URIs, optionally wire-describable.
 *
 * A route uses `accepts(uri)` to decide whether dispatch flows here.
 * `describe()` is consulted only when something wants to publish the
 * filter remotely; routes without `describe` are local-only.
 */
export interface Acceptance {
  /** True iff this route accepts the given URI. */
  accepts(uri: string): boolean;
  /** Optional serializable form for wire publication. */
  describe?(): unknown;
}

// ── Implementations ───────────────────────────────────────────────

/**
 * `patterns(...ps)` — the common case: Express-style URI patterns.
 *
 * - `:param` matches a single segment
 * - `*` matches one or more remaining segments
 * - Literal segments must match exactly
 *
 * Wire form is the raw pattern list — the canonical b3nd descriptor
 * shape.
 */
export function patterns(...ps: string[]): Acceptance {
  const compiled = ps.map((p) => p.split("/"));
  const frozen = Object.freeze([...ps]);
  return {
    accepts(uri: string): boolean {
      for (const segments of compiled) {
        if (matchPattern(segments, uri) !== null) return true;
      }
      return false;
    },
    describe(): readonly string[] {
      return frozen;
    },
  };
}

/** Accept every URI. */
export const any: Acceptance = {
  accepts: () => true,
  describe: () => ["*"],
};

/** Accept any URI starting with the given prefix. */
export function prefix(p: string): Acceptance {
  return {
    accepts: (uri) => uri.startsWith(p),
    describe: () => ({ prefix: p }),
  };
}

/**
 * Accept any URI whose scheme (the part before `://`) is in the set.
 *
 * Useful for protocol-defined acceptance: a store that handles
 * `mutable` and `hash` advertises `schemas("mutable", "hash")` without
 * needing to know wildcards.
 */
export function schemas(...names: string[]): Acceptance {
  const set = new Set(names);
  return {
    accepts(uri: string): boolean {
      const i = uri.indexOf("://");
      if (i === -1) return false;
      return set.has(uri.slice(0, i));
    },
    describe: () => ({ schemas: [...names] }),
  };
}

// ── Composition ───────────────────────────────────────────────────

/** Negate an acceptance. No `describe()` — composed filters are local-only. */
export function not(a: Acceptance): Acceptance {
  return { accepts: (uri) => !a.accepts(uri) };
}

/** Accept only when every acceptance accepts. */
export function and(...as: Acceptance[]): Acceptance {
  return { accepts: (uri) => as.every((a) => a.accepts(uri)) };
}

/** Accept when any acceptance accepts. */
export function or(...as: Acceptance[]): Acceptance {
  return { accepts: (uri) => as.some((a) => a.accepts(uri)) };
}

/**
 * @module
 * Reaction registry for the Rig.
 *
 * Reactions fire on successfully dispatched outputs (via send/receive)
 * whose URI matches a registered pattern. Patterns use the shared glob
 * grammar (`*` for one segment, `**` for the rest).
 *
 * Reactions are pure: they take the dispatched output and a `read`
 * function and return `Output[]`. The Rig feeds those returned tuples
 * back through `rig.send` (full pipeline — programs run, handlers run,
 * more reactions can fire).
 *
 * Reactions receive only the dispatched output; if a handler needs a
 * segment value, it extracts it from the URI directly.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

import {
  compilePattern,
  type Matcher,
} from "../match-pattern/match-pattern.ts";
import type { Output, ReadFn } from "../types/types.ts";

// ── Types ──

/**
 * Reaction handler — called when a dispatched URI matches the pattern.
 *
 * Receives the dispatched output and a read function. Returns the tuples
 * the Rig should put on the wire as a consequence of what the reaction
 * observed; those flow through full `rig.send` (programs + handlers +
 * more reactions).
 *
 * Returning `[]` means "I observed it but emit nothing further."
 */
export type Reaction = (
  out: Output,
  read: ReadFn,
) => Promise<Output[]>;

/** @deprecated alias kept for migration; prefer `Reaction`. */
export type ReactionHandler = Reaction;

interface ReactionEntry {
  /** The original pattern string. */
  pattern: string;
  /** Compiled matcher for this pattern. */
  matcher: Matcher;
  /** The handler to call on match. */
  handler: Reaction;
}

// ── Registry ──

/**
 * Registry of URI-pattern-matched reaction handlers.
 *
 * Use `match()` to find matching reactions for a dispatched URI; the
 * caller (the Rig) is responsible for invoking each reaction and
 * routing its returned tuples back through the pipeline.
 */
export class ReactionRegistry {
  private entries: ReactionEntry[] = [];

  /**
   * Register a reaction handler for a URI pattern.
   * Returns an unsubscribe function.
   */
  add(pattern: string, handler: Reaction): () => void {
    const entry: ReactionEntry = {
      pattern,
      matcher: compilePattern(pattern),
      handler,
    };
    this.entries.push(entry);
    return () => {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
    };
  }

  /**
   * Find every reaction whose pattern matches `uri`. Returns the list
   * of `(pattern, handler)` pairs the caller can invoke.
   */
  matches(
    uri: string,
  ): {
    pattern: string;
    handler: Reaction;
  }[] {
    const out: { pattern: string; handler: Reaction }[] = [];
    for (const entry of this.entries) {
      if (entry.matcher(uri)) {
        out.push({ pattern: entry.pattern, handler: entry.handler });
      }
    }
    return out;
  }

  /** Whether any patterns are registered. */
  get size(): number {
    return this.entries.length;
  }
}

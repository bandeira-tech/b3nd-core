/**
 * @module
 * Reaction registry for the Rig.
 *
 * Reactions fire on successfully dispatched outputs (via send/receive)
 * whose URI matches a registered pattern. Patterns use Express-style
 * matching (see `matchPattern` in b3nd-core).
 *
 * Reactions are pure: they take the dispatched output and a `read`
 * function and return `Output[]`. The Rig feeds those returned tuples
 * back through `rig.send` (full pipeline — programs run, handlers run,
 * more reactions can fire).
 *
 * Pattern parameters captured from the URI (e.g., `:id`) are passed as
 * a third argument so reactions don't have to re-parse the URI.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

import { matchPattern } from "../b3nd-core/match-pattern.ts";
import type { Output, ReadFn } from "../b3nd-core/types.ts";

// Re-export matchPattern from core — used by connections, clients, and the rig
export { matchPattern };

// ── Types ──

/**
 * Reaction handler — called when a dispatched URI matches the pattern.
 *
 * Receives the dispatched output, a read function, and the captured
 * pattern parameters. Returns the tuples the Rig should put on the
 * wire as a consequence of what the reaction observed; those flow
 * through full `rig.send` (programs + handlers + more reactions).
 *
 * Returning `[]` means "I observed it but emit nothing further."
 */
export type Reaction = (
  out: Output,
  read: ReadFn,
  params: Record<string, string>,
) => Promise<Output[]>;

/** @deprecated alias kept for migration; prefer `Reaction`. */
export type ReactionHandler = Reaction;

interface ReactionEntry {
  /** The original pattern string. */
  pattern: string;
  /** Pre-split pattern segments for matching. */
  segments: string[];
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
      segments: pattern.split("/"),
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
   * of `(handler, params)` pairs the caller can invoke.
   */
  matches(
    uri: string,
  ): { handler: Reaction; params: Record<string, string> }[] {
    const matches: { handler: Reaction; params: Record<string, string> }[] = [];
    for (const entry of this.entries) {
      const params = matchPattern(entry.segments, uri);
      if (params !== null) {
        matches.push({ handler: entry.handler, params });
      }
    }
    return matches;
  }

  /** Whether any patterns are registered. */
  get size(): number {
    return this.entries.length;
  }
}

/**
 * @module
 * URI pattern matching — shared by clients and the rig.
 *
 * Express-style matching:
 * - `:param` captures a single segment
 * - `*` matches one or more remaining segments
 * - Literal segments must match exactly
 */

/**
 * Match a URI against a pre-split pattern.
 *
 * Returns captured params on match, or `null` on no match.
 *
 * @example
 * ```ts
 * matchPattern("mutable://app/users/:id".split("/"), "mutable://app/users/alice")
 * // → { id: "alice" }
 *
 * matchPattern("hash://sha256/*".split("/"), "hash://sha256/abc123")
 * // → { "*": "abc123" }
 * ```
 */
export function matchPattern(
  patternSegments: string[],
  uri: string,
): Record<string, string> | null {
  const uriSegments = uri.split("/");
  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const pat = patternSegments[i];

    if (pat === "*") {
      // Wildcard — matches rest of segments
      params["*"] = uriSegments.slice(i).join("/");
      return params;
    }

    if (i >= uriSegments.length) return null;

    if (pat.startsWith(":")) {
      // Named param — captures one segment
      params[pat.slice(1)] = uriSegments[i];
    } else if (pat !== uriSegments[i]) {
      // Literal — must match exactly
      return null;
    }
  }

  // All pattern segments consumed — URI must not have extra segments
  if (uriSegments.length !== patternSegments.length) return null;

  return params;
}

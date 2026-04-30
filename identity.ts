/**
 * @module
 * Identity subpath — Ed25519/X25519 identity wrapper for signing,
 * verifying, encrypting, and decrypting on behalf of a single keypair.
 *
 * Pull this in standalone when an app wants to sign/encrypt without
 * needing the rest of the Rig surface.
 */

export { Identity } from "./libs/b3nd-rig/identity.ts";
export type { ExportedIdentity } from "./libs/b3nd-rig/identity.ts";

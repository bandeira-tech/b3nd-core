# Chapter 6 — Policy & identity

> Some rules don't belong to any one Canon. Auth, rate limits, audit — these
> are cross-cutting *policy*, and they live in hooks. `composeApps` chains the
> hooks from every App into one.

A program decides what a *valid post* is — that's domain logic, owned by the
posts App. But "the writer must prove who they are" and "no more than 10 writes
a second" aren't about posts, follows, or likes specifically. They apply to
everything. That's policy, and the tool is **hooks**.

## 1. Hooks recap

Hooks are synchronous gates around an operation. The contract (`src/rig/hooks.ts`):

- **Before-hooks** (`beforeSend`, `beforeReceive`, `beforeRead`) run first.
  **Throw to reject** the operation — no silent drops. Return `{ ctx }` to
  rewrite the context (e.g. normalize a payload).
- **After-hooks** run on success. They **observe only** — they cannot change
  the result, but may throw to enforce a post-condition.
- **`onError`** runs in the catch path for any pipeline error, with the failing
  `phase` (`process` | `handle` | `route` | `reaction`). Throw to abort the
  whole operation; return to let normal error handling continue.

Core stores **one function per hook slot** and freezes them at construction.
So how do five Apps each contribute a `beforeReceive`? They don't touch the
slot directly — `composeApps` **chains** them: every App's `beforeReceive` runs
in sequence, threading the (possibly rewritten) context; any throw rejects.
(The chaining code is in Chapter 8.)

## 2. Signed writes with `Identity`

`Identity` bundles Ed25519 signing + X25519 encryption. We'll require that
posts carry a valid signature from their author.

First, the author signs on the way in:

```ts
import { Identity } from "@bandeira-tech/b3nd-core";

const alice = await Identity.fromSeed("alice-secret");

const post = { id: "p1", author: "alice", text: "hello", ts: Date.now() };
const auth = await alice.sign(post); // { pubkey, signature }

await rig.receive([[Posts.uri("p1"), { post, auth }]]);
```

Then a policy App carries the verifying hook. A "policy App" is just an App
with **no routes and no Canon** — only hooks. That's a perfectly valid App; it
contributes pure cross-cutting behavior.

```ts
// chirp/apps/auth/app.ts
import { Identity } from "@bandeira-tech/b3nd-core";
import type { App, BeforeHook, ReceiveCtx } from "@bandeira-tech/b3nd-core";

// Map of handle → known public key (in reality, read from a registry).
const knownKeys: Record<string, { signing: string; encryption: string }> = { /* … */ };

const requireSignature: BeforeHook<ReceiveCtx> = async (ctx) => {
  // Only gate post writes; let everything else through.
  if (!ctx.uri.startsWith("chirp://posts/")) return;

  const { post, auth } = (ctx.data as { post?: unknown; auth?: { signature: string } }) ?? {};
  if (!post || !auth) throw new Error("auth: post write must be { post, auth }");

  const author = (post as { author: string }).author;
  const pub = knownKeys[author];
  if (!pub) throw new Error(`auth: unknown author ${author}`);

  const ok = await Identity.publicOnly(pub).verify(post, auth.signature);
  if (!ok) throw new Error("auth: bad signature");
  // returns void → proceed unchanged
};

export const authApp = (): App => ({
  name: "auth",
  hooks: { beforeReceive: requireSignature },
});
```

> Note this hook now expects the *post* payload to be wrapped as
> `{ post, auth }`. If you adopt signing, the posts Canon's validator and
> program should classify that envelope shape — a reminder that **policy and
> Canon evolve together**. Keep the wrapping decision in one place.

## 3. A rate-limit hook

A second policy App, completely independent of auth:

```ts
// chirp/apps/ratelimit/app.ts
import type { App, BeforeHook, ReceiveCtx } from "@bandeira-tech/b3nd-core";

export const rateLimitApp = (perSec = 10): App => {
  const hits: number[] = [];
  const guard: BeforeHook<ReceiveCtx> = () => {
    const now = Date.now();
    while (hits.length && now - hits[0] > 1000) hits.shift();
    if (hits.length >= perSec) throw new Error("rate limit exceeded");
    hits.push(now);
  };
  return { name: "rate-limit", hooks: { beforeReceive: guard } };
};
```

## 4. Compose policy with domain

Policy Apps compose exactly like domain Apps — they're just Apps. `composeApps`
chains the two `beforeReceive` hooks so both run on every receive.

```ts
const rig = new Rig(composeApps([
  rateLimitApp(10),   // runs first  (cheap, reject early)
  authApp(),          // runs second (only if under the limit)
  profilesApp(store),
  postsApp(store),
  likesApp(store),
  followsApp(store),
  moderationApp(store),
]));
```

**Order matters.** `composeApps` chains before-hooks in App order, so put the
cheap, high-rejection gates first. Here a flood of writes is rejected by the
rate limiter before we spend a signature verification on each.

```ts
// Under the limit, valid signature → stored.
await rig.receive([[Posts.uri("p1"), { post, auth }]]);

// Tampered payload → auth hook throws → whole receive rejects.
try {
  await rig.receive([[Posts.uri("p2"), { post: { ...post, text: "edited" }, auth }]]);
} catch (e) {
  e.message; // "auth: bad signature"
}
```

## 5. Audit with `onError`

`onError` hooks also chain. A diagnostics App can record every pipeline failure
across every behavior, with the phase that produced it:

```ts
export const auditApp = (): App => ({
  name: "audit",
  hooks: {
    onError: (ctx) => {
      logger.warn("pipeline error", { phase: ctx.phase, uri: ctx.input[0], error: ctx.error });
      // return (don't throw) → let normal error handling continue
    },
  },
});
```

We now have a node where domain behavior, derived state, and cross-cutting
policy are all separate, independently shippable Apps — composed into one PIN.
The last step is to make several such nodes talk to each other. On to
[Chapter 7 — Going distributed](./07-going-distributed.md).
</content>

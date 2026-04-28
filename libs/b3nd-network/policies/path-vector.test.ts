/**
 * @module
 * Tests for `pathVector(peers)` — flood with signer-chain loop filter.
 *
 * The full PIN surface (receive/read/observe/status) is shared with
 * `flood` and covered by `flood.test.ts`. These tests focus on the
 * filter behavior that's unique to pathVector.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { Message, ProtocolInterfaceNode } from "../../b3nd-core/types.ts";
import { pathVector } from "./path-vector.ts";
import { peer } from "../mod.ts";
import type { Peer } from "../mod.ts";

/**
 * A peer whose `client.receive` records every message it sees. Lets us
 * assert which peers received which messages under a given chain.
 */
function recordingPeer(id: string): {
  peer: Peer;
  received: Message[];
} {
  const received: Message[] = [];
  const client: ProtocolInterfaceNode = {
    receive: (msgs) => {
      received.push(...msgs);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
    read: () => Promise.resolve([]),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" as const }),
  };
  return { peer: peer(client, { id }), received };
}

/**
 * Build an AuthenticatedMessage-shaped payload whose signer chain
 * contains the given pubkeys in order. Signatures are fake — pathVector
 * only reads pubkeys, it does not verify.
 */
function authMsg(uri: string, signers: string[]): Message {
  return [
    uri,
    {
      auth: signers.map((pubkey) => ({ pubkey, signature: "fake" })),
      payload: { hello: "world" },
    },
  ];
}

// ── filter behavior ──────────────────────────────────────────────────

Deno.test("pathVector skips peers that appear in the signer chain", async () => {
  const a = recordingPeer("pk-A");
  const b = recordingPeer("pk-B");
  const npi = pathVector([a.peer, b.peer]);
  const msg = authMsg("mutable://x/1", ["pk-A"]);

  await npi.receive([msg]);

  // A is in the chain → skipped. B is fresh → delivered.
  assertEquals(a.received.length, 0);
  assertEquals(b.received.length, 1);
  assertEquals(b.received[0][0], "mutable://x/1");
});

Deno.test("pathVector handles multi-hop chains", async () => {
  const a = recordingPeer("pk-A");
  const b = recordingPeer("pk-B");
  const c = recordingPeer("pk-C");
  const npi = pathVector([a.peer, b.peer, c.peer]);
  const msg = authMsg("mutable://x/1", ["pk-A", "pk-B"]);

  await npi.receive([msg]);
  assertEquals(a.received.length, 0);
  assertEquals(b.received.length, 0);
  assertEquals(c.received.length, 1);
});

// ── no-op paths ──────────────────────────────────────────────────────

Deno.test("pathVector passes through messages lacking an auth chain", async () => {
  const a = recordingPeer("pk-A");
  const npi = pathVector([a.peer]);
  const plain: Message = ["mutable://x/1", { no: "auth here" }];

  await npi.receive([plain]);
  assertEquals(a.received.length, 1);
});

Deno.test("pathVector treats malformed auth as empty chain", async () => {
  const a = recordingPeer("pk-A");
  const npi = pathVector([a.peer]);
  const weird1: Message = ["mutable://x/1", { auth: "not-an-array" }];
  const weird2: Message = [
    "mutable://x/1",
    { auth: [{ no_pubkey: true }, { pubkey: 42 }] },
  ];

  await npi.receive([weird1, weird2]);
  assertEquals(a.received.length, 2);
});

Deno.test("pathVector handles null data gracefully", async () => {
  const a = recordingPeer("pk-A");
  const npi = pathVector([a.peer]);
  const plain: Message = ["mutable://x/1", null];

  await npi.receive([plain]);
  assertEquals(a.received.length, 1);
});

// ── mixed batch ──────────────────────────────────────────────────────

Deno.test("pathVector filters per-message within a batch", async () => {
  const a = recordingPeer("pk-A");
  const npi = pathVector([a.peer]);
  const filtered = authMsg("mutable://x/1", ["pk-A"]);
  const passed = authMsg("mutable://x/2", ["pk-B"]);
  const plain: Message = ["mutable://x/3", "bare"];

  await npi.receive([filtered, passed, plain]);
  assertEquals(a.received.length, 2);
  assertEquals(a.received[0][0], "mutable://x/2");
  assertEquals(a.received[1][0], "mutable://x/3");
});

/**
 * Tests for b3nd-encrypt module — signing, verification, encryption, decryption,
 * key derivation, PKCE, and authenticated message workflows.
 *
 * Covers: generateSigningKeyPair, sign, verify, signWithHex, encrypt, decrypt,
 * decryptWithHex, encryptSymmetric, decryptSymmetric, deriveKeyFromSeed,
 * deriveSigningKeyPairFromSeed, deriveEncryptionKeyPairFromSeed,
 * createAuthenticatedMessage, createAuthenticatedMessageWithHex,
 * verifyPayload, IdentityKey, PublicEncryptionKey, PrivateEncryptionKey,
 * SecretEncryptionKey, hmac, generateCodeVerifier, generateCodeChallenge,
 * extractPublicKeyHex, pemToCryptoKey, exportPrivateKeyPem, deriveObfuscatedPath
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  createAuthenticatedMessage,
  createAuthenticatedMessageWithHex,
  createSignedEncryptedMessage,
  decrypt,
  decryptSymmetric,
  decryptWithHex,
  deriveEncryptionKeyPairFromSeed,
  deriveKeyFromSeed,
  deriveSigningKeyPairFromSeed,
  encrypt,
  encryptSymmetric,
  exportPrivateKeyPem,
  extractPublicKeyHex,
  generateCodeChallenge,
  generateCodeVerifier,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  hmac,
  IdentityKey,
  pemToCryptoKey,
  PrivateEncryptionKey,
  PublicEncryptionKey,
  SecretEncryptionKey,
  sign,
  signWithHex,
  verify,
  verifyAndDecryptMessage,
  verifyPayload,
} from "./mod.ts";
import { deriveObfuscatedPath } from "./utils.ts";

// ---------- Key Generation ----------

Deno.test("generateSigningKeyPair — produces valid Ed25519 keypair", async () => {
  const pair = await generateSigningKeyPair();
  assertEquals(
    pair.publicKeyHex.length,
    64,
    "Ed25519 public key = 32 bytes = 64 hex",
  );
  assertEquals(/^[a-f0-9]+$/.test(pair.publicKeyHex), true);
  assertEquals(pair.privateKeyHex.length > 0, true);
});

Deno.test("generateEncryptionKeyPair — produces valid X25519 keypair", async () => {
  const pair = await generateEncryptionKeyPair();
  assertEquals(
    pair.publicKeyHex.length,
    64,
    "X25519 public key = 32 bytes = 64 hex",
  );
  assertEquals(/^[a-f0-9]+$/.test(pair.publicKeyHex), true);
});

Deno.test("generateSigningKeyPair — produces unique keypairs", async () => {
  const a = await generateSigningKeyPair();
  const b = await generateSigningKeyPair();
  assertNotEquals(a.publicKeyHex, b.publicKeyHex);
});

// ---------- Sign & Verify ----------

Deno.test("sign + verify — roundtrip succeeds", async () => {
  const pair = await generateSigningKeyPair();
  const payload = { action: "transfer", amount: 100 };

  const signature = await sign(pair.privateKey, payload);
  assertEquals(signature.length, 128, "Ed25519 signature = 64 bytes = 128 hex");

  const valid = await verify(pair.publicKeyHex, signature, payload);
  assertEquals(valid, true);
});

Deno.test("verify — fails with wrong payload", async () => {
  const pair = await generateSigningKeyPair();
  const signature = await sign(pair.privateKey, { x: 1 });

  const valid = await verify(pair.publicKeyHex, signature, { x: 2 });
  assertEquals(valid, false);
});

Deno.test("verify — fails with wrong public key", async () => {
  const pair1 = await generateSigningKeyPair();
  const pair2 = await generateSigningKeyPair();
  const payload = { test: true };

  const signature = await sign(pair1.privateKey, payload);
  const valid = await verify(pair2.publicKeyHex, signature, payload);
  assertEquals(valid, false);
});

Deno.test("sign — canonicalizes payload (key order doesn't matter)", async () => {
  const pair = await generateSigningKeyPair();
  const sig1 = await sign(pair.privateKey, { b: 2, a: 1 });
  const sig2 = await sign(pair.privateKey, { a: 1, b: 2 });
  assertEquals(sig1, sig2, "canonical JSON means key order is irrelevant");
});

Deno.test("signWithHex — same result as sign with CryptoKey", async () => {
  const pair = await generateSigningKeyPair();
  const payload = { msg: "hello" };

  const sig1 = await sign(pair.privateKey, payload);
  const sig2 = await signWithHex(pair.privateKeyHex, payload);
  assertEquals(sig1, sig2);
});

// ---------- Asymmetric Encryption (X25519 ECDH + AES-GCM) ----------

Deno.test("encrypt + decrypt — roundtrip succeeds", async () => {
  const encPair = await generateEncryptionKeyPair();
  const plaintext = new TextEncoder().encode("secret message");

  const encrypted = await encrypt(plaintext, encPair.publicKeyHex);
  assertEquals(encrypted.data.length > 0, true);
  assertEquals(encrypted.nonce.length > 0, true);
  assertEquals(typeof encrypted.ephemeralPublicKey, "string");

  const decrypted = await decrypt(
    encrypted,
    encPair.privateKey,
    encPair.publicKeyHex,
  );
  assertEquals(new TextDecoder().decode(decrypted), "secret message");
});

Deno.test("encrypt — produces different ciphertext each time (ephemeral keys)", async () => {
  const encPair = await generateEncryptionKeyPair();
  const plaintext = new TextEncoder().encode("same data");

  const enc1 = await encrypt(plaintext, encPair.publicKeyHex);
  const enc2 = await encrypt(plaintext, encPair.publicKeyHex);

  assertNotEquals(
    enc1.data,
    enc2.data,
    "ephemeral key means different ciphertext",
  );
  assertNotEquals(enc1.ephemeralPublicKey, enc2.ephemeralPublicKey);
});

Deno.test("decryptWithHex — convenience wrapper works", async () => {
  const pair = await PrivateEncryptionKey.generatePair();
  const plaintext = new TextEncoder().encode("via hex");

  const encrypted = await encrypt(plaintext, pair.publicKey.publicKeyHex);
  const decrypted = await decryptWithHex(
    encrypted,
    pair.privateKey.privateKeyHex,
  );
  assertEquals(new TextDecoder().decode(decrypted), "via hex");
});

// ---------- Symmetric Encryption (AES-GCM) ----------

Deno.test("encryptSymmetric + decryptSymmetric — roundtrip", async () => {
  const keyHex = await deriveKeyFromSeed("my-password", "my-salt", 1000);
  const plaintext = new TextEncoder().encode("symmetric secret");

  const encrypted = await encryptSymmetric(plaintext, keyHex);
  assertEquals(
    encrypted.ephemeralPublicKey,
    undefined,
    "symmetric has no ephemeral key",
  );

  const decrypted = await decryptSymmetric(encrypted, keyHex);
  assertEquals(new TextDecoder().decode(decrypted), "symmetric secret");
});

Deno.test("decryptSymmetric — wrong key fails", async () => {
  const key1 = await deriveKeyFromSeed("password1", "salt", 1000);
  const key2 = await deriveKeyFromSeed("password2", "salt", 1000);
  const plaintext = new TextEncoder().encode("data");

  const encrypted = await encryptSymmetric(plaintext, key1);
  await assertRejects(
    () => decryptSymmetric(encrypted, key2),
  );
});

// ---------- Key Derivation ----------

Deno.test("deriveKeyFromSeed — deterministic", async () => {
  const key1 = await deriveKeyFromSeed("seed", "salt", 1000);
  const key2 = await deriveKeyFromSeed("seed", "salt", 1000);
  assertEquals(key1, key2);
  assertEquals(key1.length, 64, "256-bit key = 64 hex chars");
});

Deno.test("deriveKeyFromSeed — different seeds produce different keys", async () => {
  const key1 = await deriveKeyFromSeed("seed-a", "salt", 1000);
  const key2 = await deriveKeyFromSeed("seed-b", "salt", 1000);
  assertNotEquals(key1, key2);
});

Deno.test("deriveKeyFromSeed — different salts produce different keys", async () => {
  const key1 = await deriveKeyFromSeed("seed", "salt-a", 1000);
  const key2 = await deriveKeyFromSeed("seed", "salt-b", 1000);
  assertNotEquals(key1, key2);
});

Deno.test("deriveSigningKeyPairFromSeed — deterministic Ed25519", async () => {
  const a = await deriveSigningKeyPairFromSeed("my-seed-phrase");
  const b = await deriveSigningKeyPairFromSeed("my-seed-phrase");
  assertEquals(a.publicKeyHex, b.publicKeyHex);
  assertEquals(a.privateKeyHex, b.privateKeyHex);
});

Deno.test("deriveSigningKeyPairFromSeed — different seeds produce different keys", async () => {
  const a = await deriveSigningKeyPairFromSeed("seed-1");
  const b = await deriveSigningKeyPairFromSeed("seed-2");
  assertNotEquals(a.publicKeyHex, b.publicKeyHex);
});

Deno.test("deriveSigningKeyPairFromSeed — derived key can sign and verify", async () => {
  const pair = await deriveSigningKeyPairFromSeed("test-seed");
  const payload = { action: "test" };
  const sig = await sign(pair.privateKey, payload);
  assertEquals(await verify(pair.publicKeyHex, sig, payload), true);
});

Deno.test("deriveEncryptionKeyPairFromSeed — deterministic X25519", async () => {
  const a = await deriveEncryptionKeyPairFromSeed("enc-seed");
  const b = await deriveEncryptionKeyPairFromSeed("enc-seed");
  assertEquals(a.publicKeyHex, b.publicKeyHex);
});

Deno.test("deriveEncryptionKeyPairFromSeed — can encrypt/decrypt", async () => {
  const pair = await deriveEncryptionKeyPairFromSeed("enc-seed");
  const plaintext = new TextEncoder().encode("derived encryption");
  const encrypted = await encrypt(plaintext, pair.publicKeyHex);
  const decrypted = await decrypt(
    encrypted,
    pair.privateKey,
    pair.publicKeyHex,
  );
  assertEquals(new TextDecoder().decode(decrypted), "derived encryption");
});

Deno.test("signing and encryption seeds produce different keys from same seed", async () => {
  const signing = await deriveSigningKeyPairFromSeed("same-seed");
  const encryption = await deriveEncryptionKeyPairFromSeed("same-seed");
  assertNotEquals(
    signing.publicKeyHex,
    encryption.publicKeyHex,
    "domain separation",
  );
});

// ---------- IdentityKey class ----------

Deno.test("IdentityKey.generate — creates working identity", async () => {
  const { key, privateKeyPem, publicKeyHex } = await IdentityKey.generate();
  assertEquals(publicKeyHex.length, 64);
  assertEquals(privateKeyPem.includes("BEGIN PRIVATE KEY"), true);

  const sig = await key.sign({ test: true });
  assertEquals(await verify(publicKeyHex, sig, { test: true }), true);
});

Deno.test("IdentityKey.fromPem — roundtrip from generated PEM", async () => {
  const { privateKeyPem, publicKeyHex } = await IdentityKey.generate();
  const restored = await IdentityKey.fromPem(privateKeyPem, publicKeyHex);

  const payload = { hello: "world" };
  const sig = await restored.sign(payload);
  assertEquals(await verify(publicKeyHex, sig, payload), true);
});

Deno.test("IdentityKey.fromHex — roundtrip from hex keys", async () => {
  const pair = await generateSigningKeyPair();
  const key = await IdentityKey.fromHex({
    privateKeyHex: pair.privateKeyHex,
    publicKeyHex: pair.publicKeyHex,
  });

  const payload = { test: 42 };
  const sig = await key.sign(payload);
  assertEquals(await verify(pair.publicKeyHex, sig, payload), true);
});

// ---------- PublicEncryptionKey / PrivateEncryptionKey ----------

Deno.test("PrivateEncryptionKey.generatePair — encrypt/decrypt roundtrip", async () => {
  const { privateKey, publicKey } = await PrivateEncryptionKey.generatePair();
  const plaintext = new TextEncoder().encode("class-based encryption");

  const encrypted = await publicKey.encrypt(plaintext);
  const decrypted = await privateKey.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "class-based encryption");
});

Deno.test("PrivateEncryptionKey.fromHex — restore from hex", async () => {
  const { privateKey: orig, publicKey } = await PrivateEncryptionKey
    .generatePair();
  const restored = await PrivateEncryptionKey.fromHex({
    privateKeyHex: orig.privateKeyHex,
    publicKeyHex: orig.publicKeyHex,
  });

  const plaintext = new TextEncoder().encode("restored");
  const encrypted = await publicKey.encrypt(plaintext);
  const decrypted = await restored.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "restored");
});

Deno.test("PrivateEncryptionKey.toPublic — returns PublicEncryptionKey", async () => {
  const { privateKey } = await PrivateEncryptionKey.generatePair();
  const pub = privateKey.toPublic();
  assertEquals(pub.publicKeyHex, privateKey.publicKeyHex);
});

Deno.test("PublicEncryptionKey.fromHex — works with generated pair", async () => {
  const pair = await generateEncryptionKeyPair();
  const pubKey = await PublicEncryptionKey.fromHex(pair.publicKeyHex);
  assertEquals(pubKey.publicKeyHex, pair.publicKeyHex);
  assertEquals(pubKey.toHex(), pair.publicKeyHex);
});

// ---------- SecretEncryptionKey ----------

Deno.test("SecretEncryptionKey.fromSecret — encrypt/decrypt roundtrip", async () => {
  const key = await SecretEncryptionKey.fromSecret({
    secret: "my-secret",
    salt: "my-salt",
    iterations: 1000,
  });

  const plaintext = new TextEncoder().encode("secret data");
  const encrypted = await key.encrypt(plaintext);
  const decrypted = await key.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "secret data");
});

Deno.test("SecretEncryptionKey.fromHex — restore from derived hex", async () => {
  const keyHex = await deriveKeyFromSeed("pass", "salt", 1000);
  const key = SecretEncryptionKey.fromHex(keyHex);

  const plaintext = new TextEncoder().encode("from hex");
  const encrypted = await key.encrypt(plaintext);
  const decrypted = await key.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "from hex");
});

// ---------- Authenticated Messages ----------

Deno.test("createAuthenticatedMessage — sign with multiple signers", async () => {
  const pair1 = await generateSigningKeyPair();
  const pair2 = await generateSigningKeyPair();
  const payload = { action: "multi-sign" };

  const msg = await createAuthenticatedMessage(payload, [
    { privateKey: pair1.privateKey, publicKeyHex: pair1.publicKeyHex },
    { privateKey: pair2.privateKey, publicKeyHex: pair2.publicKeyHex },
  ]);

  assertEquals(msg.auth.length, 2);
  assertEquals(msg.payload, payload);

  // Both signatures verify
  assertEquals(
    await verify(pair1.publicKeyHex, msg.auth[0].signature, payload),
    true,
  );
  assertEquals(
    await verify(pair2.publicKeyHex, msg.auth[1].signature, payload),
    true,
  );
});

Deno.test("createAuthenticatedMessageWithHex — convenience wrapper", async () => {
  const pair = await generateSigningKeyPair();
  const payload = { tx: "send" };

  const msg = await createAuthenticatedMessageWithHex(
    payload,
    pair.publicKeyHex,
    pair.privateKeyHex,
  );

  assertEquals(msg.auth.length, 1);
  assertEquals(msg.auth[0].pubkey, pair.publicKeyHex);
  assertEquals(
    await verify(pair.publicKeyHex, msg.auth[0].signature, payload),
    true,
  );
});

Deno.test("verifyPayload — validates all signers", async () => {
  const pair1 = await generateSigningKeyPair();
  const pair2 = await generateSigningKeyPair();
  const payload = { data: "test" };

  const msg = await createAuthenticatedMessage(payload, [
    { privateKey: pair1.privateKey, publicKeyHex: pair1.publicKeyHex },
    { privateKey: pair2.privateKey, publicKeyHex: pair2.publicKeyHex },
  ]);

  const result = await verifyPayload({ payload, auth: msg.auth });
  assertEquals(result.verified, true);
  assertEquals(result.signers.length, 2);
});

Deno.test("verifyPayload — detects tampered payload", async () => {
  const pair = await generateSigningKeyPair();
  const payload = { data: "original" };

  const msg = await createAuthenticatedMessage(payload, [
    { privateKey: pair.privateKey, publicKeyHex: pair.publicKeyHex },
  ]);

  const result = await verifyPayload({
    payload: { data: "tampered" },
    auth: msg.auth,
  });
  assertEquals(result.verified, false);
  assertEquals(result.signers.length, 0);
});

// ---------- Signed + Encrypted Messages ----------

Deno.test("createSignedEncryptedMessage + verifyAndDecryptMessage — full workflow", async () => {
  const { key: identity, publicKeyHex } = await IdentityKey.generate();
  const encKey = await SecretEncryptionKey.fromSecret({
    secret: "shared-secret",
    salt: "channel-salt",
    iterations: 1000,
  });

  const plaintext = new TextEncoder().encode("confidential payload");

  const msg = await createSignedEncryptedMessage({
    data: plaintext,
    identity,
    encryptionKey: encKey,
  });

  assertEquals(msg.auth.length, 1);
  assertEquals(msg.auth[0].pubkey, publicKeyHex);
  assertEquals(typeof msg.payload.data, "string");
  assertEquals(typeof msg.payload.nonce, "string");

  const result = await verifyAndDecryptMessage({
    message: msg,
    encryptionKey: encKey,
  });
  assertEquals(result.verified, true);
  assertEquals(result.signers.length, 1);
  assertEquals(new TextDecoder().decode(result.data), "confidential payload");
});

// ---------- PEM utilities ----------

Deno.test("exportPrivateKeyPem — produces valid PEM format", async () => {
  const pair = await generateSigningKeyPair();
  const pem = await exportPrivateKeyPem(pair.privateKey, "PRIVATE KEY");

  assertEquals(pem.startsWith("-----BEGIN PRIVATE KEY-----"), true);
  assertEquals(pem.endsWith("-----END PRIVATE KEY-----"), true);

  // Roundtrip: import PEM back
  const restored = await pemToCryptoKey(pem, "Ed25519");
  const payload = { roundtrip: true };
  const sig = await sign(restored, payload);
  assertEquals(await verify(pair.publicKeyHex, sig, payload), true);
});

Deno.test("extractPublicKeyHex — extracts from private key", async () => {
  const pair = await generateSigningKeyPair();
  // Need extractable key for this
  const pem = await exportPrivateKeyPem(pair.privateKey, "PRIVATE KEY");
  const importedKey = await pemToCryptoKey(pem, "Ed25519", true);
  const extracted = await extractPublicKeyHex(importedKey);
  assertEquals(extracted, pair.publicKeyHex);
});

// ---------- HMAC ----------

Deno.test("hmac — deterministic", async () => {
  const a = await hmac("key", "data");
  const b = await hmac("key", "data");
  assertEquals(a, b);
  assertEquals(a.length, 64, "HMAC-SHA256 = 32 bytes = 64 hex");
});

Deno.test("hmac — different keys produce different results", async () => {
  const a = await hmac("key1", "data");
  const b = await hmac("key2", "data");
  assertNotEquals(a, b);
});

Deno.test("hmac — different data produce different results", async () => {
  const a = await hmac("key", "data1");
  const b = await hmac("key", "data2");
  assertNotEquals(a, b);
});

// ---------- PKCE (RFC 7636) ----------

Deno.test("generateCodeVerifier — produces base64url string", () => {
  const verifier = generateCodeVerifier();
  assertEquals(verifier.length, 43);
  assertEquals(
    /^[A-Za-z0-9\-_]+$/.test(verifier),
    true,
    "base64url chars only",
  );
  assertEquals(verifier.includes("="), false, "no padding");
  assertEquals(verifier.includes("+"), false, "no + (base64url)");
  assertEquals(verifier.includes("/"), false, "no / (base64url)");
});

Deno.test("generateCodeChallenge — deterministic from verifier", async () => {
  const verifier = generateCodeVerifier();
  const a = await generateCodeChallenge(verifier);
  const b = await generateCodeChallenge(verifier);
  assertEquals(a, b);
  assertEquals(a.length, 43);
  assertEquals(/^[A-Za-z0-9\-_]+$/.test(a), true);
});

Deno.test("generateCodeChallenge — different verifiers produce different challenges", async () => {
  const v1 = generateCodeVerifier();
  const v2 = generateCodeVerifier();
  const c1 = await generateCodeChallenge(v1);
  const c2 = await generateCodeChallenge(v2);
  assertNotEquals(c1, c2);
});

// ---------- deriveObfuscatedPath (utils.ts) ----------

Deno.test("deriveObfuscatedPath — deterministic", async () => {
  const a = await deriveObfuscatedPath("secret", "user", "profile");
  const b = await deriveObfuscatedPath("secret", "user", "profile");
  assertEquals(a, b);
  assertEquals(a.length, 32, "truncated to 32 hex chars");
});

Deno.test("deriveObfuscatedPath — different secrets produce different paths", async () => {
  const a = await deriveObfuscatedPath("secret1", "user", "profile");
  const b = await deriveObfuscatedPath("secret2", "user", "profile");
  assertNotEquals(a, b);
});

Deno.test("deriveObfuscatedPath — different parts produce different paths", async () => {
  const a = await deriveObfuscatedPath("secret", "user", "profile");
  const b = await deriveObfuscatedPath("secret", "user", "settings");
  assertNotEquals(a, b);
});

// ---------- Edge Cases ----------

Deno.test("sign — rejects non-serializable payload", async () => {
  const pair = await generateSigningKeyPair();
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  await assertRejects(
    () => sign(pair.privateKey, circular),
    Error,
  );
});

Deno.test("pemToCryptoKey — rejects empty PEM", async () => {
  await assertRejects(
    () => pemToCryptoKey("", "Ed25519"),
    Error,
    "Invalid PEM",
  );
});

Deno.test("verify — handles corrupt signature gracefully", async () => {
  const pair = await generateSigningKeyPair();
  const valid = await verify(pair.publicKeyHex, "not-hex", { test: true });
  assertEquals(
    valid,
    false,
    "corrupt signature should return false, not throw",
  );
});

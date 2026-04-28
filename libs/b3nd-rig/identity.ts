/**
 * @module
 * Identity — unified keypair bundle for b3nd.
 *
 * Wraps Ed25519 signing + X25519 encryption into a single object.
 * Deterministic derivation from seed, or fresh random generation.
 */

import {
  type AuthenticatedMessage,
  createAuthenticatedMessage,
  decrypt as asymDecrypt,
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  encrypt as asymEncrypt,
  type EncryptedPayload,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  pemToCryptoKey,
  sign as edSign,
  verify as edVerify,
} from "../b3nd-encrypt/mod.ts";
import { decodeHex, encodeHex } from "../b3nd-core/encoding.ts";

/**
 * Portable identity data — JSON-serializable for persistence.
 *
 * Store this in localStorage, a file, or a database to restore
 * a full signing+encryption identity across sessions.
 */
export interface ExportedIdentity {
  /** Ed25519 public key hex. */
  signingPublicKeyHex: string;
  /** Ed25519 private key hex (PKCS8). Present only for full identities. */
  signingPrivateKeyHex?: string;
  /** X25519 public encryption key hex. */
  encryptionPublicKeyHex: string;
  /** X25519 private encryption key hex (PKCS8). Present only for full identities. */
  encryptionPrivateKeyHex?: string;
}

/**
 * Identity bundles signing (Ed25519) and encryption (X25519) keypairs.
 *
 * It can be created with full private keys (for signing/decrypting)
 * or as a public-only identity (for addressing/encrypting to others).
 */
export class Identity {
  /** Ed25519 public key hex — the user's address on the network. */
  readonly pubkey: string;
  /** X25519 public encryption key hex. */
  readonly encryptionPubkey: string;
  /** Whether this identity has a signing private key (can sign messages). */
  readonly canSign: boolean;
  /** Whether this identity has an encryption private key (can decrypt). */
  readonly canEncrypt: boolean;

  private readonly _signingPrivateKey: CryptoKey | null;
  private readonly _encryptionPrivateKey: CryptoKey | null;

  private constructor(opts: {
    pubkey: string;
    encryptionPubkey: string;
    signingPrivateKey: CryptoKey | null;
    encryptionPrivateKey: CryptoKey | null;
  }) {
    this.pubkey = opts.pubkey;
    this.encryptionPubkey = opts.encryptionPubkey;
    this._signingPrivateKey = opts.signingPrivateKey;
    this._encryptionPrivateKey = opts.encryptionPrivateKey;
    this.canSign = opts.signingPrivateKey !== null;
    this.canEncrypt = opts.encryptionPrivateKey !== null;
  }

  // ── Factory methods ──

  /** Generate a fresh random identity. */
  static async generate(): Promise<Identity> {
    const signing = await generateSigningKeyPair();
    const encryption = await generateEncryptionKeyPair();
    return new Identity({
      pubkey: signing.publicKeyHex,
      encryptionPubkey: encryption.publicKeyHex,
      signingPrivateKey: signing.privateKey,
      encryptionPrivateKey: encryption.privateKey,
    });
  }

  /** Derive a deterministic identity from a seed string. */
  static async fromSeed(seed: string): Promise<Identity> {
    const signing = await deriveSigningKeyPairFromSeed(seed);
    const encryption = await deriveEncryptionKeyPairFromSeed(seed);
    return new Identity({
      pubkey: signing.publicKeyHex,
      encryptionPubkey: encryption.publicKeyHex,
      signingPrivateKey: signing.privateKey,
      encryptionPrivateKey: encryption.privateKey,
    });
  }

  /** Create identity from an Ed25519 PEM private key. */
  static async fromPem(
    signingPem: string,
    pubkeyHex: string,
    encryptionPrivateKeyHex?: string,
    encryptionPublicKeyHex?: string,
  ): Promise<Identity> {
    const signingPrivateKey = await pemToCryptoKey(signingPem, "Ed25519");

    let encPrivKey: CryptoKey | null = null;
    let encPubHex = encryptionPublicKeyHex || "";

    if (encryptionPrivateKeyHex) {
      const privBytes = decodeHex(encryptionPrivateKeyHex).buffer;
      encPrivKey = await crypto.subtle.importKey(
        "pkcs8",
        privBytes,
        { name: "X25519", namedCurve: "X25519" },
        true,
        ["deriveBits"],
      );

      if (!encPubHex) {
        // Derive public from private via JWK round-trip
        const jwk = await crypto.subtle.exportKey("jwk", encPrivKey);
        const pub = await crypto.subtle.importKey(
          "jwk",
          { kty: jwk.kty, crv: jwk.crv, x: jwk.x, key_ops: [] },
          { name: "X25519", namedCurve: "X25519" },
          true,
          [],
        );
        encPubHex = encodeHex(
          new Uint8Array(await crypto.subtle.exportKey("raw", pub)),
        );
      }
    }

    return new Identity({
      pubkey: pubkeyHex,
      encryptionPubkey: encPubHex,
      signingPrivateKey,
      encryptionPrivateKey: encPrivKey,
    });
  }

  /** Create a public-only identity (for addressing others). Cannot sign or decrypt. */
  static publicOnly(keys: {
    signing: string;
    encryption?: string;
  }): Identity {
    return new Identity({
      pubkey: keys.signing,
      encryptionPubkey: keys.encryption || "",
      signingPrivateKey: null,
      encryptionPrivateKey: null,
    });
  }

  /**
   * Reconstruct an Identity from exported data.
   *
   * @example Persist across browser sessions
   * ```typescript
   * // Save
   * const exported = await identity.export();
   * localStorage.setItem("b3nd-id", JSON.stringify(exported));
   *
   * // Restore
   * const saved = JSON.parse(localStorage.getItem("b3nd-id")!);
   * const identity = await Identity.fromExport(saved);
   * ```
   */
  static async fromExport(data: ExportedIdentity): Promise<Identity> {
    let signingPrivateKey: CryptoKey | null = null;
    let encryptionPrivateKey: CryptoKey | null = null;

    if (data.signingPrivateKeyHex) {
      const pkcs8Bytes = decodeHex(data.signingPrivateKeyHex);
      signingPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        pkcs8Bytes.buffer,
        { name: "Ed25519", namedCurve: "Ed25519" },
        true,
        ["sign"],
      );
    }

    if (data.encryptionPrivateKeyHex) {
      const pkcs8Bytes = decodeHex(data.encryptionPrivateKeyHex);
      encryptionPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        pkcs8Bytes.buffer,
        { name: "X25519", namedCurve: "X25519" },
        true,
        ["deriveBits"],
      );
    }

    return new Identity({
      pubkey: data.signingPublicKeyHex,
      encryptionPubkey: data.encryptionPublicKeyHex,
      signingPrivateKey,
      encryptionPrivateKey,
    });
  }

  // ── Operations ──

  /** Sign a payload — returns `{ pubkey, signature }` auth entry. */
  async sign(payload: unknown): Promise<{ pubkey: string; signature: string }> {
    if (!this._signingPrivateKey) {
      throw new Error("Cannot sign: this is a public-only identity");
    }
    const signature = await edSign(this._signingPrivateKey, payload);
    return { pubkey: this.pubkey, signature };
  }

  /** Wrap a payload into an AuthenticatedMessage with this identity's signature. */
  async signMessage<T>(payload: T): Promise<AuthenticatedMessage<T>> {
    if (!this._signingPrivateKey) {
      throw new Error("Cannot sign: this is a public-only identity");
    }
    return createAuthenticatedMessage(payload, [{
      privateKey: this._signingPrivateKey,
      publicKeyHex: this.pubkey,
    }]);
  }

  /** Verify a signature against this identity's public key. */
  async verify(payload: unknown, signature: string): Promise<boolean> {
    return edVerify(this.pubkey, signature, payload);
  }

  /** Encrypt data for a recipient's public encryption key. */
  async encrypt(
    data: Uint8Array,
    recipientEncPubkeyHex: string,
  ): Promise<EncryptedPayload> {
    return asymEncrypt(data, recipientEncPubkeyHex);
  }

  /** Decrypt data sent to this identity. */
  async decrypt(payload: EncryptedPayload): Promise<Uint8Array> {
    if (!this._encryptionPrivateKey) {
      throw new Error("Cannot decrypt: no encryption private key");
    }
    return asymDecrypt(payload, this._encryptionPrivateKey);
  }

  /**
   * Export this identity to a JSON-serializable object.
   *
   * For full identities (with private keys), exports everything needed
   * to reconstruct the identity later via `Identity.fromExport()`.
   * For public-only identities, only public keys are exported.
   */
  async export(): Promise<ExportedIdentity> {
    const result: ExportedIdentity = {
      signingPublicKeyHex: this.pubkey,
      encryptionPublicKeyHex: this.encryptionPubkey,
    };

    if (this._signingPrivateKey) {
      const pkcs8 = await crypto.subtle.exportKey(
        "pkcs8",
        this._signingPrivateKey,
      );
      result.signingPrivateKeyHex = encodeHex(new Uint8Array(pkcs8));
    }

    if (this._encryptionPrivateKey) {
      const pkcs8 = await crypto.subtle.exportKey(
        "pkcs8",
        this._encryptionPrivateKey,
      );
      result.encryptionPrivateKeyHex = encodeHex(new Uint8Array(pkcs8));
    }

    return result;
  }

  /**
   * Get the signer object for use with managed-node and other APIs
   * that expect `{ privateKey: CryptoKey; publicKeyHex: string }`.
   */
  get signer(): { privateKey: CryptoKey; publicKeyHex: string } {
    if (!this._signingPrivateKey) {
      throw new Error("Cannot get signer: this is a public-only identity");
    }
    return {
      privateKey: this._signingPrivateKey,
      publicKeyHex: this.pubkey,
    };
  }
}

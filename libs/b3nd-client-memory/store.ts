/**
 * MemoryStore — in-memory reference implementation of Store.
 *
 * Pure mechanical storage with no protocol awareness.
 * Write entries, read entries, delete entries.
 * Observation is a client concern — see `ObserveEmitter`.
 *
 * @example
 * ```typescript
 * import { MemoryStore } from "@bandeira-tech/b3nd-sdk";
 *
 * const store = new MemoryStore();
 *
 * await store.write([
 *   { uri: "mutable://app/config", data: { theme: "dark" } },
 * ]);
 *
 * const results = await store.read(["mutable://app/config"]);
 * console.log(results[0]?.record?.data); // { theme: "dark" }
 * ```
 */

import type {
  DeleteResult,
  ReadResult,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
} from "../b3nd-core/types.ts";

type StorageNode<T = unknown> = {
  value?: { data: T };
  children?: Map<string, StorageNode>;
};

type Storage = Map<string, StorageNode>;

function resolveTarget(
  uri: string,
  storage: Storage,
): { program: string; path: string; node: StorageNode; parts: string[] } {
  const url = URL.parse(uri)!;
  const program = `${url.protocol}//${url.hostname}`;

  let node = storage.get(program);
  if (!node) {
    node = { children: new Map() };
    storage.set(program, node);
  }

  const parts = url.pathname.substring(1).split("/");
  return { program, path: url.pathname, node, parts };
}

export class MemoryStore implements Store {
  private storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage || new Map();
  }

  // ── Write ────────────────────────────────────────────────────────

  async write(entries: StoreEntry[]): Promise<StoreWriteResult[]> {
    const results: StoreWriteResult[] = [];

    for (const entry of entries) {
      try {
        this._writeOne(entry.uri, {
          data: entry.data,
        });
        results.push({ success: true });
      } catch (err) {
        results.push({
          success: false,
          error: err instanceof Error ? err.message : "Write failed",
        });
      }
    }

    return results;
  }

  private _writeOne(
    uri: string,
    record: { data: unknown },
  ): void {
    const { node, parts } = resolveTarget(uri, this.storage);

    let current = node;
    for (const segment of parts.filter(Boolean)) {
      if (!current.children) current.children = new Map();
      if (!current.children.get(segment)) {
        const child: StorageNode = {};
        current.children.set(segment, child);
        current = child;
      } else {
        current = current.children.get(segment)!;
      }
    }

    current.value = record;
  }

  // ── Read ─────────────────────────────────────────────────────────

  async read<T = unknown>(uris: string[]): Promise<ReadResult<T>[]> {
    const results: ReadResult<T>[] = [];

    for (const uri of uris) {
      if (uri.endsWith("/")) {
        results.push(...this._list<T>(uri));
      } else {
        results.push(this._readOne<T>(uri));
      }
    }

    return results;
  }

  private _readOne<T>(uri: string): ReadResult<T> {
    const { parts, node } = resolveTarget(uri, this.storage);

    let current: StorageNode | undefined = node;
    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) {
        return { success: false, error: `Path not found: ${part}` };
      }
    }

    if (!current.value) {
      return { success: false, error: "Not found" };
    }

    return {
      success: true,
      record: current.value as { data: T },
    };
  }

  private _list<T>(uri: string): ReadResult<T>[] {
    const { node, parts, program, path } = resolveTarget(uri, this.storage);
    let current: StorageNode | undefined = node;

    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) return [];
    }

    if (!current.children?.size) return [];

    const prefix = `${program}${path}`;
    const results: ReadResult<T>[] = [];

    function collectLeaves(node: StorageNode, currentUri: string) {
      if (node.value !== undefined) {
        results.push({
          success: true,
          uri: currentUri,
          record: node.value as { data: T },
        });
      }
      if (node.children) {
        for (const [key, child] of node.children) {
          collectLeaves(child, `${currentUri}/${key}`);
        }
      }
    }

    for (const [key, child] of current.children) {
      collectLeaves(child, `${prefix}${key}`);
    }

    return results;
  }

  // ── Delete ───────────────────────────────────────────────────────

  async delete(uris: string[]): Promise<DeleteResult[]> {
    const results: DeleteResult[] = [];

    for (const uri of uris) {
      try {
        this._deleteOne(uri);
        results.push({ success: true });
      } catch (err) {
        results.push({
          success: false,
          error: err instanceof Error ? err.message : "Delete failed",
        });
      }
    }

    return results;
  }

  private _deleteOne(uri: string): void {
    const { node, parts } = resolveTarget(uri, this.storage);
    const filteredParts = parts.filter(Boolean);

    let current: StorageNode | undefined = node;
    const ancestors: { node: StorageNode; key: string }[] = [];

    for (const part of filteredParts) {
      if (!current?.children?.has(part)) return;
      ancestors.push({ node: current, key: part });
      current = current.children.get(part)!;
    }

    delete current.value;

    // Clean up empty ancestors (leaf-to-root)
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const { node: parent, key } = ancestors[i];
      const child = parent.children!.get(key)!;
      if (!child.value && (!child.children || child.children.size === 0)) {
        parent.children!.delete(key);
      } else {
        break;
      }
    }
  }

  // ── Status ───────────────────────────────────────────────────────

  status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      schema: [...this.storage.keys()],
    });
  }

  capabilities(): StoreCapabilities {
    return {
      atomicBatch: false,
      binaryData: false,
    };
  }
}

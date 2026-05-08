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
  Output,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
} from "../b3nd-core/types.ts";
import type { ParsedUrl } from "../b3nd-core/url.ts";
import { countUri, parseUrl } from "../b3nd-core/url.ts";

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

  write(entries: StoreEntry[]): Promise<StoreWriteResult[]> {
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

    return Promise.resolve(results);
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

  read<T = unknown>(urls: string[]): Promise<Output<T>[]> {
    const out: Output<T>[] = [];

    for (const url of urls) {
      const parsed = parseUrl(url);
      switch (parsed.fn) {
        case "read": {
          const found = this._readOne<T>(parsed.uri);
          // Option-A: "not found" surfaces as absence (no Output).
          if (found !== undefined) out.push(found);
          break;
        }
        case "ls":
          out.push(...this._list<T>(parsed));
          break;
        case "count":
          out.push(this._count(parsed) as unknown as Output<T>);
          break;
        default:
          // Programmer error — unknown fn is not a domain "not found".
          throw new Error(`MemoryStore: unsupported fn '${parsed.fn}'`);
      }
    }

    return Promise.resolve(out);
  }

  private _readOne<T>(uri: string): Output<T> | undefined {
    const { parts, node } = resolveTarget(uri, this.storage);

    let current: StorageNode | undefined = node;
    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) return undefined;
    }

    if (!current.value) return undefined;
    return [uri, (current.value as { data: T }).data];
  }

  /**
   * Walk the prefix and collect leaves into `[uri, payload]` Output
   * tuples. Returns the raw entries; callers apply ls or count
   * semantics.
   */
  private _walk(uri: string): Output[] {
    const { node, parts, program, path } = resolveTarget(uri, this.storage);
    let current: StorageNode | undefined = node;

    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) return [];
    }

    const out: Output[] = [];
    const prefix = path.endsWith("/")
      ? `${program}${path}`
      : `${program}${path}/`;

    function collect(n: StorageNode, currentUri: string) {
      if (n.value !== undefined) {
        out.push([currentUri, (n.value as { data: unknown }).data]);
      }
      if (n.children) {
        for (const [key, child] of n.children) {
          collect(child, `${currentUri}/${key}`);
        }
      }
    }

    if (current.children) {
      for (const [key, child] of current.children) {
        collect(child, `${prefix}${key}`);
      }
    } else if (current.value !== undefined) {
      out.push([
        `${program}${path}`,
        (current.value as { data: unknown }).data,
      ]);
    }

    return out;
  }

  private _list<T>(parsed: ParsedUrl): Output<T>[] {
    const { params } = parsed;

    // Programmer errors: unsupported params throw — option-A reserves
    // "not found" for the absence channel.
    if (params.pattern !== undefined) {
      throw new Error("MemoryStore: pattern filter not supported");
    }
    if (params.sortBy !== undefined && params.sortBy !== "uri") {
      throw new Error(`MemoryStore: unsupported sortBy: ${params.sortBy}`);
    }
    const format = params.format ?? "full";
    if (format !== "full" && format !== "uris") {
      throw new Error(`MemoryStore: unsupported format: ${format}`);
    }

    let entries = this._walk(parsed.uri);

    if (params.sortBy === "uri") {
      const dir = params.sortOrder === "desc" ? -1 : 1;
      entries.sort(([a], [b]) => a.localeCompare(b) * dir);
    }

    if (params.limit !== undefined) {
      const page = params.page ?? 1;
      const start = (page - 1) * params.limit;
      entries = entries.slice(start, start + params.limit);
    }

    if (format === "uris") {
      return entries.map(([uri]) => [uri, undefined as T]);
    }
    return entries as Output<T>[];
  }

  private _count(parsed: ParsedUrl): Output<number> {
    if (parsed.params.pattern !== undefined) {
      throw new Error("MemoryStore: pattern filter not supported");
    }
    const n = this._walk(parsed.uri).length;
    return [countUri(parsed.uri), n];
  }

  // ── Delete ───────────────────────────────────────────────────────

  delete(uris: string[]): Promise<DeleteResult[]> {
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

    return Promise.resolve(results);
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
      fns: ["read", "ls", "count"],
    });
  }

  capabilities(): StoreCapabilities {
    return {
      atomicBatch: false,
      binaryData: false,
    };
  }
}

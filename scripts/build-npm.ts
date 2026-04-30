#!/usr/bin/env -S deno run -A
/**
 * Build an NPM package from the Deno source via @deno/dnt.
 *
 * Output: ./npm/  — a Node-compatible package published as
 * `@bandeira-tech/b3nd-core` on npmjs.com. Same import surface as JSR.
 *
 * Usage:
 *   deno task build:npm           # build only
 *   deno task build:npm --publish # build + npm publish
 */

// deno-lint-ignore-file no-import-prefix
import { build, emptyDir } from "jsr:@deno/dnt@^0.42.1";

const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = denoJson.version as string;

await emptyDir("./npm");

await build({
  entryPoints: [
    { name: ".", path: "./mod.ts" },
    { name: "./types", path: "./types.ts" },
    { name: "./encoding", path: "./encoding.ts" },
    { name: "./binary", path: "./binary.ts" },
    { name: "./network", path: "./network.ts" },
    { name: "./rig", path: "./rig.ts" },
    { name: "./identity", path: "./identity.ts" },
    { name: "./client-http", path: "./client-http.ts" },
    { name: "./client-ws", path: "./client-ws.ts" },
    { name: "./client-memory", path: "./client-memory.ts" },
    { name: "./client-console", path: "./client-console.ts" },
  ],
  outDir: "./npm",
  // Deno.* types aren't in the published surface (verified) — no shim needed.
  shims: { deno: false },
  // Tests live under libs/ and are Deno-only; skip the Node test build.
  test: false,
  // Don't generate a separate CommonJS build — modern Node + bundlers want ESM.
  scriptModule: false,
  // Use the latest stable TS target so consumers get crisp d.ts.
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
  },
  package: {
    name: "@bandeira-tech/b3nd-core",
    version,
    description:
      "B3nd Core — framework foundation: types, encoding, clients, rig, network",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/bandeira-tech/b3nd-core.git",
    },
    bugs: {
      url: "https://github.com/bandeira-tech/b3nd-core/issues",
    },
    homepage: "https://github.com/bandeira-tech/b3nd-core#readme",
    engines: {
      node: ">=20",
    },
    sideEffects: false,
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");

    // Add `types` field to each export entry so TS resolves d.ts under
    // moduleResolution Node16/NodeNext/Bundler.
    const pkgPath = "npm/package.json";
    const pkg = JSON.parse(Deno.readTextFileSync(pkgPath));
    for (const [name, entry] of Object.entries(pkg.exports)) {
      const e = entry as { import?: string; types?: string };
      if (e.import && !e.types) {
        e.types = e.import.replace(/\.js$/, ".d.ts");
        // Convention: types must come first in the conditions list.
        pkg.exports[name] = { types: e.types, import: e.import };
      }
    }
    Deno.writeTextFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  },
});

console.log(`\n✔ Built @bandeira-tech/b3nd-core@${version} → ./npm/`);

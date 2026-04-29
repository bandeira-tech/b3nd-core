import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    "src/mod": "src/mod.ts",
    "types/mod": "src/types.ts",
    "encoding/mod": "src/encoding.ts",
    "binary/mod": "src/binary.ts",
    "network/mod": "src/network.ts",
    "client-console/mod": "src/client-console.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
});

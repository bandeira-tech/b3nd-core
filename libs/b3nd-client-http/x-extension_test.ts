/// <reference lib="deno.ns" />
/**
 * x-* extension round-trip through the HTTP transport.
 *
 * Pins that:
 *  - `fn=x-<ns>.<name>` survives the wire from client → server,
 *  - extension params (`x-*` keys) reach the executing client intact,
 *  - the server returns the executing client's `ReadResult` unchanged.
 */

import { assertEquals } from "@std/assert";
import { HttpClient } from "./mod.ts";
import { x } from "../b3nd-core/url.ts";
import { FunctionalClient } from "../b3nd-core/functional-client.ts";
import { connection } from "../b3nd-rig/connection.ts";
import { httpApi } from "../b3nd-rig/http.ts";
import { Rig } from "../b3nd-rig/rig.ts";
import { parseUrl } from "../b3nd-core/url.ts";

Deno.test("HTTP - x-* extension round-trip", async () => {
  // Echo client: parses each url and returns the parsed { fn, params, ext }
  // as the record's data. If the url makes it through the rig + HTTP
  // wire intact, the echoed payload matches what we sent.
  const echoClient = new FunctionalClient({
    read: <T = unknown>(urls: string[]) =>
      Promise.resolve(urls.map((url) => {
        const parsed = parseUrl(url);
        return {
          success: true as const,
          record: {
            data: {
              fn: parsed.fn,
              params: parsed.params,
              ext: parsed.ext,
            } as T,
          },
        };
      })),
  });

  const serverRig = new Rig({
    routes: { read: [connection(echoClient, ["*"])] },
  });
  const server = Deno.serve(
    { port: 0, onListen() {} },
    httpApi(serverRig),
  );
  const port = server.addr.port;

  try {
    const client = new HttpClient({ url: `http://127.0.0.1:${port}` });

    const url = x("mutable://things/", "x-test.scan", {
      limit: 50,
      ext: { "x-test.cursor": "abc123", "x-test.where": "active=true" },
    });

    const [r] = await client.read<{
      fn: string;
      params: { limit?: number };
      ext: Record<string, string>;
    }>([url]);

    assertEquals(r.success, true);
    assertEquals(r.record?.data.fn, "x-test.scan");
    assertEquals(r.record?.data.params.limit, 50);
    assertEquals(r.record?.data.ext["x-test.cursor"], "abc123");
    assertEquals(r.record?.data.ext["x-test.where"], "active=true");
  } finally {
    await server.shutdown();
  }
});

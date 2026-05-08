/// <reference lib="deno.ns" />
/**
 * HttpClient.read() error and ls-mode handling.
 */

import { assertEquals } from "@std/assert";
import { HttpClient } from "./mod.ts";

function createClientWithServer(handler: (req: Request) => Response): {
  client: HttpClient;
  server: Deno.HttpServer;
} {
  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  const client = new HttpClient({ url: `http://localhost:${addr.port}` });
  return { client, server };
}

Deno.test("read: HTTP 500 yields per-url failure result", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Internal Server Error", { status: 500 }),
  );

  try {
    const results = await client.read(["mutable://open/test/"]);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
    assertEquals(typeof results[0].error, "string");
  } finally {
    await server.shutdown();
  }
});

Deno.test("read: HTTP 404 yields per-url failure result", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Not Found", { status: 404 }),
  );

  try {
    const results = await client.read(["mutable://open/test/"]);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
  } finally {
    await server.shutdown();
  }
});

Deno.test("read: network error yields per-url failure result", async () => {
  const client = new HttpClient({ url: "http://localhost:1" });
  const results = await client.read(["mutable://open/test/"]);
  assertEquals(results.length, 1);
  assertEquals(results[0].success, false);
});

Deno.test("read: ls-mode passes through ReadResult[] from server", async () => {
  const { client, server } = createClientWithServer(() => {
    const mockResults = [
      {
        success: true,
        uri: "mutable://open/test/item1",
        record: { data: { value: 1 } },
      },
      {
        success: true,
        uri: "mutable://open/test/item2",
        record: { data: { value: 2 } },
      },
    ];
    return new Response(JSON.stringify(mockResults), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const results = await client.read(["mutable://open/test/"]);
    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(results[1].success, true);
  } finally {
    await server.shutdown();
  }
});

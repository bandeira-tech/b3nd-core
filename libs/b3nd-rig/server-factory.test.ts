import { assertEquals } from "@std/assert";
import { createServers } from "./server-factory.ts";
import type { ServerResolver, TransportServer } from "./server-factory.ts";
import type { Rig } from "./rig.ts";

// Minimal stub rig — createServers only passes it through
const stubRig = {} as Rig;

function fakeResolver(
  transport: string,
): ServerResolver & { created: TransportServer[] } {
  const created: TransportServer[] = [];
  return {
    transport,
    created,
    create(rig: Rig): TransportServer {
      assertEquals(rig, stubRig);
      const server: TransportServer = {
        transport,
        address: `${transport}://0.0.0.0:0`,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      };
      created.push(server);
      return server;
    },
  };
}

Deno.test("createServers returns one server per resolver", () => {
  const http = fakeResolver("http");
  const grpc = fakeResolver("grpc");

  const servers = createServers(stubRig, [http, grpc]);

  assertEquals(servers.length, 2);
  assertEquals(servers[0].transport, "http");
  assertEquals(servers[1].transport, "grpc");
});

Deno.test("createServers with empty resolvers returns empty array", () => {
  const servers = createServers(stubRig, []);
  assertEquals(servers.length, 0);
});

Deno.test("createServers passes rig to each resolver", () => {
  const r1 = fakeResolver("a");
  const r2 = fakeResolver("b");

  createServers(stubRig, [r1, r2]);

  assertEquals(r1.created.length, 1);
  assertEquals(r2.created.length, 1);
});

Deno.test("TransportServer lifecycle", async () => {
  let started = false;
  let stopped = false;

  const resolver: ServerResolver = {
    transport: "test",
    create(): TransportServer {
      return {
        transport: "test",
        address: "test://0.0.0.0:0",
        async start() {
          started = true;
        },
        async stop() {
          stopped = true;
        },
      };
    },
  };

  const [server] = createServers(stubRig, [resolver]);
  await server.start();
  assertEquals(started, true);
  await server.stop();
  assertEquals(stopped, true);
});

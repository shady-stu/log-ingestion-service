import Fastify from "fastify";
import { createBearerAuthHook } from "../src/api/auth";
import {describe, expect, it, jest} from '@jest/globals';
describe("bearer authentication hook", () => {
  const token = "loadgen-secret";

  it.each([
    ["missing credentials", undefined],
    ["invalid scheme", "Basic loadgen-secret"],
    ["wrong token", "Bearer wrong-token"],
  ])("rejects %s", async (_name, authorization) => {
    const app = createApp(token);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: authorization ? { authorization } : undefined,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("allows the configured bearer token", async () => {
    const app = createApp(token);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});

function createApp(token: string) {
  const app = Fastify();
  app.get(
    "/protected",
    { onRequest: [createBearerAuthHook(token)] },
    async () => ({ ok: true })
  );
  return app;
}

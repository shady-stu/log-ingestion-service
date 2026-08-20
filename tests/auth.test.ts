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

  it("rejects data access when authentication has no seeded key", async () => {
    const app = createApp(undefined);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer any-key" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts the optional X-API-Key header", async () => {
    const app = createApp(token);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { "x-api-key": token },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("returns 403 when the authenticated key lacks a required scope", async () => {
    const app = Fastify();
    app.get(
      "/protected",
      {
        onRequest: [createBearerAuthHook(token, {
          requiredScopes: ["ingest"],
          grantedScopes: ["query"],
        })],
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
    await app.close();
  });

  it("rate limits repeated invalid credentials with Retry-After", async () => {
    const app = createApp(token);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer wrong-token" },
      });

      expect(response.statusCode).toBe(401);
    }

    const limitedResponse = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(limitedResponse.statusCode).toBe(429);
    expect(Number(limitedResponse.headers["retry-after"])).toBeGreaterThan(0);
    expect(limitedResponse.json()).toEqual({ error: "Too Many Requests" });
    await app.close();
  });
});

function createApp(token: string | undefined) {
  const app = Fastify();
  app.get(
    "/protected",
    { onRequest: [createBearerAuthHook(token)] },
    async () => ({ ok: true })
  );
  return app;
}

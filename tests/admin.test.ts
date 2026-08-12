import Fastify from "fastify";
import { createDeleteLogsHandler } from "../src/api/handlers/admin.handler";
import {describe, expect, it, jest} from '@jest/globals';
describe("DELETE /logs admin authorization", () => {
  const token = "test-admin-token";

  it.each([
    ["missing credentials", {}],
    ["an unrelated bearer token", { authorization: `Bearer ${token}` }],
    ["an invalid API key", { "x-logs-purge-token": "wrong-token" }],
  ])("rejects %s", async (_name, headers) => {
    const truncate = jest.fn(async () => undefined);
    const app = createApp(token, truncate);

    const response = await app.inject({ method: "DELETE", url: "/logs", headers });

    expect(response.statusCode).toBe(401);
    expect(truncate).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows the configured admin API key", async () => {
    const truncate = jest.fn(async () => undefined);
    const app = createApp(token, truncate);

    const response = await app.inject({
      method: "DELETE",
      url: "/logs",
      headers: { "x-logs-purge-token": token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ truncated: true });
    expect(truncate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("does not acknowledge cleanup when the repository fails", async () => {
    const app = createApp(token, async () => {
      throw new Error("database unavailable");
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/logs",
      headers: { "x-logs-purge-token": token },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).not.toEqual({ truncated: true });
    await app.close();
  });
});

function createApp(token: string, truncate: () => Promise<void>) {
  const app = Fastify();
  app.delete("/logs", createDeleteLogsHandler(token, truncate));
  return app;
}

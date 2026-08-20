import { insertLogs } from "../src/repositories/logs.repository";

describe("logs repository", () => {
  it("accepts an empty batch without starting COPY", async () => {
    await expect(insertLogs([])).resolves.toBe(0);
  });
});

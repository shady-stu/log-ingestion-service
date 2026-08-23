const BASE_URL = process.env.CONTRACT_BASE_URL ?? "http://localhost:8080";
const authEnabled = process.env.AUTH_ENABLED === "true";
const apiKey = process.env.CONTRACT_API_KEY ?? process.env.LOADGEN_API_KEY;

if (authEnabled && !apiKey) {
  throw new Error("CONTRACT_API_KEY is required when AUTH_ENABLED=true");
}

const now = new Date();
const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const until = now.toISOString();
const requests = [
  { name: "health", method: "GET", path: "/health" },
  {
    name: "post logs",
    method: "POST",
    path: "/logs",
    body: {
      logs: [{
        timestamp: now.toISOString(),
        level: "info",
        service: "ci-contract",
        message: "contract smoke test",
        attributes: { ci: true },
      }],
    },
  },
  { name: "get logs", method: "GET", path: "/logs?limit=1" },
  {
    name: "aggregate logs",
    method: "GET",
    path: `/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&bucket=1m`,
  },
];

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function run() {
  if (authEnabled) {
    await expectStatus(requests[0], {}, 200);

    for (const request of requests.slice(1)) {
      await expectStatus(request, {}, 401);
    }
  }

  const headers = authEnabled
    ? { authorization: `Bearer ${apiKey}` }
    : {};

  for (const request of requests) {
    await expectStatus(request, headers, 200);
  }

  console.log(JSON.stringify({
    authEnabled,
    endpoints: requests.map(({ name }) => name),
    status: "passed",
  }));
}

async function expectStatus(request, headers, expectedStatus) {
  const response = await fetch(`${BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...headers,
      ...(request.body ? { "content-type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(
      `${request.name} expected HTTP ${expectedStatus}, got ${response.status}: ${body}`
    );
  }
}

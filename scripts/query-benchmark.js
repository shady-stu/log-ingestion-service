const URL = process.env.QUERY_BENCHMARK_URL ?? "http://localhost:8080/logs";
const REQUESTS = Number(process.env.QUERY_BENCHMARK_REQUESTS ?? 30);
const TIME_RANGE = "since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-31T00%3A00%3A00.000Z";

async function run() {
  const deepCursor = await getDeepCursor();
  const queries = [
    ["Default", "?limit=100"],
    ["Service + time", `?service=checkout&${TIME_RANGE}&limit=100`],
    ["Level + time", `?level=error&${TIME_RANGE}&limit=100`],
    ["Service + level + time", `?service=checkout&level=error&${TIME_RANGE}&limit=100`],
    ["Attribute + time", `?attr.user_id=42&${TIME_RANGE}&limit=100`],
    ["q + time", `?q=declined&${TIME_RANGE}&limit=100`],
    ["Deep cursor", `?limit=100&cursor=${encodeURIComponent(deepCursor)}`],
    ["Combined", `?service=checkout&level=error&attr.region=eu-west&q=declined&${TIME_RANGE}&limit=100`],
  ];
  const samplesByQuery = new Map(
    queries.map(([name]) => [name, { samples: [], failed: 0 }])
  );

  for (let requestIndex = 0; requestIndex < REQUESTS; requestIndex++) {
    for (const [name, query] of queries) {
      await benchmarkRequest(query, samplesByQuery.get(name));
    }
  }

  const results = Object.fromEntries(
    queries.map(([name]) => [name, summarize(samplesByQuery.get(name))])
  );

  console.log(JSON.stringify(results, null, 2));
}

async function getDeepCursor() {
  let cursor = null;

  for (let page = 0; page < 30; page++) {
    const response = await fetch(`${URL}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const body = await response.json();

    if (!response.ok || !body.next_cursor) {
      throw new Error("Unable to build deep cursor");
    }

    cursor = body.next_cursor;
  }

  return cursor;
}

async function benchmarkRequest(query, result) {
  const startedAt = performance.now();
  const response = await fetch(`${URL}${query}`);
  const body = await response.json();

  if (!response.ok || !Array.isArray(body.logs)) {
    result.failed++;
    return;
  }

  result.samples.push(performance.now() - startedAt);
}

function summarize(result) {
  const samples = result.samples.toSorted((left, right) => left - right);

  return {
    sent: REQUESTS,
    completed: samples.length,
    failed: result.failed,
    p50: percentile(samples, 0.5),
    p90: percentile(samples, 0.9),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function percentile(samples, quantile) {
  if (samples.length === 0) {
    return null;
  }

  return Math.round(
    samples[Math.min(samples.length - 1, Math.ceil(samples.length * quantile) - 1)] * 100
  ) / 100;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

const URL = process.env.AGGREGATE_BENCHMARK_URL ?? "http://localhost:8080/logs/aggregate";
const REQUESTS_PER_SHAPE = Number(process.env.AGGREGATE_BENCHMARK_REQUESTS ?? 5);
const REQUEST_INTERVAL_MS = 1000;
const LAST_HOUR = "since=2025-01-12T12%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const LAST_DAY = "since=2025-01-11T13%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const WIDE_RANGE = "since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-13T00%3A00%3A00.000Z";

const queries = [
  ["1h / 1m", `?${LAST_HOUR}&bucket=1m`],
  ["1h / 1m + service group", `?${LAST_HOUR}&bucket=1m&group_by=service`],
  ["1h / 1m + level group", `?${LAST_HOUR}&bucket=1m&group_by=level`],
  ["1d / 1h", `?${LAST_DAY}&bucket=1h`],
  ["1d / 1h + service group", `?${LAST_DAY}&bucket=1h&group_by=service`],
  ["wide / 1d", `?${WIDE_RANGE}&bucket=1d`],
  ["service + time", `?${LAST_DAY}&bucket=1h&service=checkout`],
  ["level + time", `?${LAST_DAY}&bucket=1h&level=error`],
  ["attribute + time", `?${LAST_DAY}&bucket=1h&attr.user_id=42`],
  ["q + time", `?${LAST_DAY}&bucket=1h&q=declined`],
  ["combined filters", `?${LAST_DAY}&bucket=1h&service=checkout&level=error&attr.region=eu-west&q=declined`],
];

async function run() {
  const results = new Map(
    queries.map(([name]) => [name, { samples: [], failed: 0 }])
  );
  let nextRequestAt = performance.now();

  for (let requestIndex = 0; requestIndex < REQUESTS_PER_SHAPE; requestIndex++) {
    for (const [name, query] of queries) {
      await benchmarkRequest(query, results.get(name));
      nextRequestAt += REQUEST_INTERVAL_MS;
      await waitForNextRequest(nextRequestAt);
    }
  }

  console.log(JSON.stringify({
    requestsPerShape: REQUESTS_PER_SHAPE,
    aggregateRequestsPerSecond: 1,
    results: Object.fromEntries(
      queries.map(([name]) => [name, summarize(results.get(name))])
    ),
  }, null, 2));
}

async function benchmarkRequest(query, result) {
  const startedAt = performance.now();

  try {
    const response = await fetch(`${URL}${query}`);
    const body = await response.json();

    if (!response.ok || !Array.isArray(body.buckets)) {
      result.failed++;
      return;
    }

    result.samples.push(performance.now() - startedAt);
  } catch {
    result.failed++;
  }
}

async function waitForNextRequest(nextRequestAt) {
  const delay = Math.max(0, nextRequestAt - performance.now());
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function summarize(result) {
  const samples = result.samples.toSorted((left, right) => left - right);

  return {
    sent: REQUESTS_PER_SHAPE,
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

  const index = Math.min(samples.length - 1, Math.ceil(samples.length * quantile) - 1);
  return Math.round(samples[index] * 100) / 100;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

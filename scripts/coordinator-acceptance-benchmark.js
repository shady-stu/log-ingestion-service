const BASE_URL = process.env.COORDINATOR_BENCHMARK_URL ?? "http://localhost:8080";
const DURATION_SECONDS = Number(process.env.COORDINATOR_BENCHMARK_DURATION ?? 55);
const REQUEST_INTERVAL_MS = 1000;
const LAST_HOUR = "since=2025-01-12T12%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const LAST_DAY = "since=2025-01-11T13%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const WIDE_RANGE = "since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-13T00%3A00%3A00.000Z";

const primaryAggregate = ["primary 1h / 1m", `/logs/aggregate?${LAST_HOUR}&bucket=1m`];
const wideAggregate = ["wide / 1d", `/logs/aggregate?${WIDE_RANGE}&bucket=1d`];
const getQueries = [
  ["default", "/logs?limit=100"],
  ["service + time", `/logs?service=checkout&${LAST_DAY}&limit=100`],
  ["attribute + time", `/logs?attr.user_id=42&${LAST_DAY}&limit=100`],
  ["combined filters", `/logs?service=checkout&level=error&attr.region=eu-west&q=declined&${LAST_DAY}&limit=100`],
];

async function run() {
  const primaryResults = createResult();
  const wideResults = createResult();
  const getResults = new Map(getQueries.map(([name]) => [name, createResult()]));
  const requests = [];
  const startedAt = performance.now();

  for (let second = 0; second < DURATION_SECONDS; second++) {
    requests.push(benchmarkRequest(primaryAggregate[1], primaryResults, "buckets"));

    const [getName, getPath] = getQueries[second % getQueries.length];
    requests.push(benchmarkRequest(getPath, getResults.get(getName), "logs"));

    if (second % 11 === 5) {
      requests.push(benchmarkRequest(wideAggregate[1], wideResults, "buckets"));
    }

    await waitUntil(startedAt + (second + 1) * REQUEST_INTERVAL_MS);
  }

  await Promise.all(requests);

  console.log(JSON.stringify({
    durationSeconds: DURATION_SECONDS,
    primaryAggregateRequestsPerSecond: 1,
    primaryAggregate: summarize(primaryResults),
    wideAggregate: summarize(wideResults),
    getLogs: Object.fromEntries(
      getQueries.map(([name]) => [name, summarize(getResults.get(name))])
    ),
  }, null, 2));
}

function createResult() {
  return { sent: 0, samples: [], failed: 0 };
}

async function benchmarkRequest(path, result, responseField) {
  result.sent++;
  const startedAt = performance.now();

  try {
    const response = await fetch(`${BASE_URL}${path}`);
    const body = await response.json();

    if (!response.ok || !Array.isArray(body[responseField])) {
      result.failed++;
      return;
    }

    result.samples.push(performance.now() - startedAt);
  } catch {
    result.failed++;
  }
}

function summarize(result) {
  const samples = result.samples.sort((left, right) => left - right);

  return {
    sent: result.sent,
    completed: samples.length,
    failed: result.failed,
    p50: percentile(samples, 0.5),
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

async function waitUntil(timestamp) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, timestamp - performance.now())));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

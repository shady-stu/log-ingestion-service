const BASE_URL = process.env.MIXED_BENCHMARK_URL ?? "http://localhost:8080";
const DURATION_SECONDS = Number(process.env.MIXED_BENCHMARK_DURATION ?? 55);
const REQUEST_INTERVAL_MS = 1000;
const LAST_HOUR = "since=2025-01-12T12%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const LAST_DAY = "since=2025-01-11T13%3A46%3A40.000Z&until=2025-01-12T13%3A46%3A40.000Z";
const WIDE_RANGE = "since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-13T00%3A00%3A00.000Z";

const aggregateQueries = [
  ["1h / 1m", `/logs/aggregate?${LAST_HOUR}&bucket=1m`],
  ["1h / 1m + service group", `/logs/aggregate?${LAST_HOUR}&bucket=1m&group_by=service`],
  ["1h / 1m + level group", `/logs/aggregate?${LAST_HOUR}&bucket=1m&group_by=level`],
  ["1d / 1h", `/logs/aggregate?${LAST_DAY}&bucket=1h`],
  ["1d / 1h + service group", `/logs/aggregate?${LAST_DAY}&bucket=1h&group_by=service`],
  ["wide / 1d", `/logs/aggregate?${WIDE_RANGE}&bucket=1d`],
  ["service + time", `/logs/aggregate?${LAST_DAY}&bucket=1h&service=checkout`],
  ["level + time", `/logs/aggregate?${LAST_DAY}&bucket=1h&level=error`],
  ["attribute + time", `/logs/aggregate?${LAST_DAY}&bucket=1h&attr.user_id=42`],
  ["q + time", `/logs/aggregate?${LAST_DAY}&bucket=1h&q=declined`],
  ["combined filters", `/logs/aggregate?${LAST_DAY}&bucket=1h&service=checkout&level=error&attr.region=eu-west&q=declined`],
];

const getQueries = [
  ["default", "/logs?limit=100"],
  ["service + time", `/logs?service=checkout&${LAST_DAY}&limit=100`],
  ["attribute + time", `/logs?attr.user_id=42&${LAST_DAY}&limit=100`],
  ["combined filters", `/logs?service=checkout&level=error&attr.region=eu-west&q=declined&${LAST_DAY}&limit=100`],
];

async function run() {
  const aggregateResults = createResults(aggregateQueries);
  const getResults = createResults(getQueries);
  const requests = [];
  const benchmarkStartedAt = performance.now();

  for (let second = 0; second < DURATION_SECONDS; second++) {
    const aggregateQuery = aggregateQueries[second % aggregateQueries.length];
    const getQuery = getQueries[second % getQueries.length];

    requests.push(benchmarkRequest(aggregateQuery, aggregateResults, "buckets"));
    requests.push(benchmarkRequest(getQuery, getResults, "logs"));

    const nextRequestAt = benchmarkStartedAt + (second + 1) * REQUEST_INTERVAL_MS;
    await waitUntil(nextRequestAt);
  }

  await Promise.all(requests);

  console.log(JSON.stringify({
    durationSeconds: DURATION_SECONDS,
    aggregateRequestsPerSecond: 1,
    getRequestsPerSecond: 1,
    aggregate: summarizeQueries(aggregateQueries, aggregateResults),
    getLogs: summarizeQueries(getQueries, getResults),
  }, null, 2));
}

function createResults(queries) {
  return new Map(queries.map(([name]) => [name, { sent: 0, samples: [], failed: 0 }]));
}

async function benchmarkRequest([name, path], results, responseField) {
  const result = results.get(name);
  const startedAt = performance.now();
  result.sent++;

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

function summarizeQueries(queries, results) {
  return Object.fromEntries(
    queries.map(([name]) => [name, summarize(results.get(name))])
  );
}

function summarize(result) {
  const samples = result.samples.toSorted((left, right) => left - right);

  return {
    sent: result.sent,
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

async function waitUntil(timestamp) {
  const delay = Math.max(0, timestamp - performance.now());
  await new Promise((resolve) => setTimeout(resolve, delay));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

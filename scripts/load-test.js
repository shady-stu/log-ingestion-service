const URL = process.env.LOAD_TEST_URL ?? "http://localhost:8080/logs";
const RATE = Number(process.env.LOAD_TEST_RATE ?? 15000);
const DURATION = Number(process.env.LOAD_TEST_DURATION ?? 60);
const BATCH_SIZE = Number(process.env.LOAD_TEST_BATCH_SIZE ?? 1000);
const MAX_IN_FLIGHT = Number(process.env.LOAD_TEST_MAX_IN_FLIGHT ?? 30);
const DRAIN_TIMEOUT_SECONDS = Number(
  process.env.LOAD_TEST_DRAIN_TIMEOUT_SECONDS ?? 30
);

let sent = 0;
let accepted = 0;
let rejected = 0;
let failed = 0;
let inFlight = 0;
let skippedBatches = 0;
const requestControllers = new Set();
const successfulLatencyMs = [];

function createLog() {
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    service: "load-test",
    message: "testing ingestion performance",
    attributes: {
      user_id: Math.floor(Math.random() * 10000),
      success: true,
      latency: 120,
    },
  };
}

async function sendBatch() {
  if (inFlight >= MAX_IN_FLIGHT) {
    skippedBatches++;
    return;
  }

  inFlight++;
  sent += BATCH_SIZE;
  const controller = new AbortController();
  requestControllers.add(controller);
  const requestStartedAt = performance.now();

  const logs = Array.from({ length: BATCH_SIZE }, createLog);

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ logs }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      failed += BATCH_SIZE;
      console.log("ERROR:", response.status, data);
      return;
    }

    accepted += data.accepted ?? 0;
    rejected += data.rejected?.length ?? 0;
    successfulLatencyMs.push(performance.now() - requestStartedAt);
  } catch (error) {
    failed += BATCH_SIZE;
    console.log("REQUEST FAILED:", error.message);
  } finally {
    requestControllers.delete(controller);
    inFlight--;
  }
}

async function waitForInflightRequests() {
  const deadline = Date.now() + DRAIN_TIMEOUT_SECONDS * 1000;

  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const timedOut = inFlight > 0;

  if (timedOut) {
    for (const controller of requestControllers) {
      controller.abort();
    }

    while (inFlight > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return !timedOut;
}

async function run() {
  const start = performance.now();
  const requestsPerSecond = RATE / BATCH_SIZE;
  const interval = 1000 / requestsPerSecond;
  const endAt = start + DURATION * 1000;
  let nextDispatchAt = start;

  console.log({
    URL,
    RATE,
    BATCH_SIZE,
    MAX_IN_FLIGHT,
    DRAIN_TIMEOUT_SECONDS,
    requestsPerSecond,
    duration: DURATION,
  });

  while (performance.now() < endAt) {
    while (nextDispatchAt <= performance.now() && nextDispatchAt < endAt) {
      void sendBatch();
      nextDispatchAt += interval;
    }

    const delay = Math.max(0, nextDispatchAt - performance.now());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const drained = await waitForInflightRequests();

  const seconds = (performance.now() - start) / 1000;

  console.log("\nRESULT");
  console.log({
    seconds,
    sent,
    accepted,
    rejected,
    failed,
    skippedBatches,
    inFlight,
    drained,
    throughput: Math.floor(accepted / DURATION),
    completionThroughput: Math.floor(accepted / seconds),
    latencyMs: latencyPercentiles(successfulLatencyMs),
  });
}

function latencyPercentiles(samples) {
  if (samples.length === 0) {
    return null;
  }

  samples.sort((left, right) => left - right);

  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function percentile(samples, quantile) {
  const index = Math.min(
    samples.length - 1,
    Math.ceil(samples.length * quantile) - 1
  );

  return Math.round(samples[index] * 100) / 100;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

const BASE_URL = process.env.LEADERBOARD_URL ?? "http://localhost:8080";
const BATCH_SIZE = Number(process.env.LEADERBOARD_BATCH_SIZE ?? 33);
const MAX_IN_FLIGHT = Number(process.env.LEADERBOARD_MAX_IN_FLIGHT ?? 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.LEADERBOARD_REQUEST_TIMEOUT_MS ?? 30000);
const DRAIN_TIMEOUT_MS = Number(process.env.LEADERBOARD_DRAIN_TIMEOUT_MS ?? 30000);
const DURATION_SCALE = Number(process.env.LEADERBOARD_DURATION_SCALE ?? 1);
const SAMPLE_INTERVAL_MS = 5000;
const AGGREGATE_INTERVAL_MS = 1000;

const scenarios = {
  load: [{ name: "load", rate: 15000, durationSeconds: duration(120) }],
  stress: [
    { name: "stage-1", rate: 15000, durationSeconds: duration(30) },
    { name: "stage-2", rate: 22500, durationSeconds: duration(60) },
    { name: "stage-3", rate: 30000, durationSeconds: duration(60) },
  ],
  spike: [
    { name: "baseline", rate: 7500, durationSeconds: duration(30) },
    { name: "spike", rate: 30000, durationSeconds: duration(10) },
    { name: "recovery", rate: 7500, durationSeconds: duration(60) },
  ],
  breakpoint: [
    { name: "stage-1", rate: 15000, durationSeconds: duration(30) },
    { name: "stage-2", rate: 22500, durationSeconds: duration(30) },
    { name: "stage-3", rate: 30000, durationSeconds: duration(30) },
    { name: "stage-4", rate: 45000, durationSeconds: duration(30) },
  ],
};

const selectedScenario = process.env.LEADERBOARD_SCENARIO ?? "load";
const scenarioNames = selectedScenario === "all"
  ? Object.keys(scenarios)
  : [selectedScenario];

let inFlight = 0;
let sequence = 0;
const controllers = new Set();

async function main() {
  validateConfiguration();
  const results = [];

  for (const name of scenarioNames) {
    results.push(await runScenario(name, scenarios[name]));
  }

  console.log("\nLEADERBOARD BENCHMARK RESULT");
  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    batchSize: BATCH_SIZE,
    maxInFlight: MAX_IN_FLIGHT,
    scenarios: results,
  }, null, 2));
}

async function runScenario(name, stages) {
  const runId = `${name}-${Date.now()}`;
  const result = createResult(name, stages, runId);
  const durationMs = stages.reduce(
    (total, stage) => total + stage.durationSeconds * 1000,
    0
  );
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();

  console.log(`\n${name.toUpperCase()}`, {
    stages,
    batchSize: BATCH_SIZE,
    maxInFlight: MAX_IN_FLIGHT,
  });

  const aggregatePromise = runAggregateTraffic(result.aggregate, durationMs);
  await dispatchStages(stages, result, runId);
  await aggregatePromise;
  result.drained = await waitForDrain();
  result.elapsedSeconds = round((performance.now() - startedAt) / 1000);
  result.visibility = await measureVisibility(runId, startedAtIso, result.accepted);
  return summarize(result);
}

async function dispatchStages(stages, result, runId) {
  for (const stage of stages) {
    const stageResult = createStageResult(stage);
    result.stages.push(stageResult);
    await dispatchStage(stageResult, result, runId);
  }
}

async function dispatchStage(stage, result, runId) {
  const startedAt = performance.now();
  const endAt = startedAt + stage.durationSeconds * 1000;
  const intervalMs = (BATCH_SIZE / stage.rate) * 1000;
  let nextDispatchAt = startedAt;
  let nextSampleAt = startedAt + SAMPLE_INTERVAL_MS;
  let lastAccepted = result.accepted;

  while (performance.now() < endAt) {
    const now = performance.now();

    while (nextDispatchAt <= now && nextDispatchAt < endAt) {
      void sendBatch(result, stage, runId);
      nextDispatchAt += intervalMs;
    }

    while (nextSampleAt <= now && nextSampleAt <= endAt) {
      const accepted = result.accepted - lastAccepted;
      stage.samples.push({
        second: round((nextSampleAt - startedAt) / 1000),
        target: stage.rate,
        achieved: round(accepted / (SAMPLE_INTERVAL_MS / 1000)),
      });
      lastAccepted = result.accepted;
      nextSampleAt += SAMPLE_INTERVAL_MS;
    }

    const wakeAt = Math.min(nextDispatchAt, nextSampleAt, endAt);
    await sleep(Math.max(0, wakeAt - performance.now()));
  }

  while (nextDispatchAt < endAt) {
    void sendBatch(result, stage, runId);
    nextDispatchAt += intervalMs;
  }
}

async function sendBatch(result, stage, runId) {
  if (inFlight >= MAX_IN_FLIGHT) {
    result.skippedBatches++;
    stage.skippedBatches++;
    return;
  }

  const logs = Array.from({ length: BATCH_SIZE }, () => createLog(runId));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  inFlight++;
  controllers.add(controller);
  result.sent += logs.length;
  stage.sent += logs.length;
  result.httpRequests.sent++;
  stage.httpRequests.sent++;

  try {
    const response = await fetch(`${BASE_URL}/logs`, {
      method: "POST",
      headers: requestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ logs }),
      signal: controller.signal,
    });
    const body = await response.json();

    if (!response.ok) {
      result.failed += logs.length;
      stage.failed += logs.length;
      result.httpRequests.failed++;
      stage.httpRequests.failed++;
      return;
    }

    const accepted = body.accepted ?? 0;
    const rejected = body.rejected?.length ?? 0;
    result.accepted += accepted;
    result.rejected += rejected;
    stage.accepted += accepted;
    stage.rejected += rejected;
    result.httpRequests.succeeded++;
    stage.httpRequests.succeeded++;
    result.postLatencies.push(performance.now() - startedAt);
  } catch {
    result.failed += logs.length;
    stage.failed += logs.length;
    result.httpRequests.failed++;
    stage.httpRequests.failed++;
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
    inFlight--;
  }
}

async function runAggregateTraffic(result, durationMs) {
  const startedAt = performance.now();
  let nextRequestAt = startedAt;
  const requests = [];

  while (nextRequestAt < startedAt + durationMs) {
    await sleep(Math.max(0, nextRequestAt - performance.now()));
    requests.push(sendAggregateRequest(result));
    nextRequestAt += AGGREGATE_INTERVAL_MS;
  }

  await Promise.all(requests);
}

async function sendAggregateRequest(result) {
  result.sent++;
  const requestStartedAt = performance.now();
  const until = new Date();
  const since = new Date(until.getTime() - 60 * 60 * 1000);
  const params = new URLSearchParams({
    since: since.toISOString(),
    until: until.toISOString(),
    bucket: "1m",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/logs/aggregate?${params}`, {
      headers: requestHeaders(),
      signal: controller.signal,
    });
    const body = await response.json();

    if (!response.ok || !Array.isArray(body.buckets)) {
      result.failed++;
    } else {
      result.completed++;
      result.latencies.push(performance.now() - requestStartedAt);
    }
  } catch {
    result.failed++;
  } finally {
    clearTimeout(timeout);
  }
}

async function measureVisibility(runId, since, accepted) {
  const params = new URLSearchParams({
    since,
    until: new Date(Date.now() + 1000).toISOString(),
    bucket: "1h",
    "attr.run_id": runId,
  });

  try {
    const response = await fetch(`${BASE_URL}/logs/aggregate?${params}`, {
      headers: requestHeaders(),
    });
    const body = await response.json();
    const visible = Array.isArray(body.buckets)
      ? body.buckets.reduce((total, bucket) => total + Number(bucket.count), 0)
      : 0;
    return {
      acknowledged: accepted,
      visible,
      missing: Math.max(0, accepted - visible),
      visibleButUnacknowledged: Math.max(0, visible - accepted),
    };
  } catch {
    return {
      acknowledged: accepted,
      visible: null,
      missing: null,
      visibleButUnacknowledged: null,
    };
  }
}

async function waitForDrain() {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await sleep(100);
  }

  if (inFlight === 0) return true;
  for (const controller of controllers) controller.abort();
  while (inFlight > 0) await sleep(10);
  return false;
}

function createLog(runId) {
  sequence++;
  return {
    timestamp: new Date().toISOString(),
    level: sequence % 20 === 0 ? "error" : "info",
    service: "leaderboard-load",
    message: sequence % 20 === 0 ? "simulated request failure" : "request completed",
    attributes: { run_id: runId, sequence, success: sequence % 20 !== 0 },
  };
}

function createResult(name, stages, runId) {
  return {
    name,
    runId,
    plannedDurationSeconds: stages.reduce(
      (total, stage) => total + stage.durationSeconds,
      0
    ),
    sent: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
    skippedBatches: 0,
    httpRequests: { sent: 0, succeeded: 0, failed: 0 },
    postLatencies: [],
    aggregate: { sent: 0, completed: 0, failed: 0, latencies: [] },
    stages: [],
    drained: false,
  };
}

function createStageResult(stage) {
  return {
    ...stage,
    sent: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
    skippedBatches: 0,
    httpRequests: { sent: 0, succeeded: 0, failed: 0 },
    samples: [],
  };
}

function summarize(result) {
  return {
    name: result.name,
    plannedDurationSeconds: result.plannedDurationSeconds,
    elapsedSeconds: result.elapsedSeconds,
    sent: result.sent,
    accepted: result.accepted,
    rejected: result.rejected,
    failed: result.failed,
    skippedBatches: result.skippedBatches,
    httpRequests: {
      ...result.httpRequests,
      errorRatePercent: result.httpRequests.sent === 0
        ? 0
        : round((result.httpRequests.failed / result.httpRequests.sent) * 100),
    },
    throughput: Math.floor(result.accepted / result.plannedDurationSeconds),
    completionThroughput: Math.floor(result.accepted / result.elapsedSeconds),
    postLatencyMs: percentiles(result.postLatencies),
    aggregate: {
      sent: result.aggregate.sent,
      completed: result.aggregate.completed,
      failed: result.aggregate.failed,
      latencyMs: percentiles(result.aggregate.latencies),
    },
    visibility: result.visibility,
    drained: result.drained,
    stages: result.stages,
  };
}

function percentiles(samples) {
  if (samples.length === 0) return null;
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(samples, quantile) {
  const index = Math.min(
    samples.length - 1,
    Math.ceil(samples.length * quantile) - 1
  );
  return round(samples[index]);
}

function requestHeaders(extra = {}) {
  const apiKey = process.env.LOADGEN_API_KEY;
  return apiKey
    ? { ...extra, authorization: `Bearer ${apiKey}` }
    : extra;
}

function validateConfiguration() {
  if (!scenarios[selectedScenario] && selectedScenario !== "all") {
    throw new Error(`Unknown LEADERBOARD_SCENARIO: ${selectedScenario}`);
  }
  for (const [name, value] of Object.entries({ BATCH_SIZE, MAX_IN_FLIGHT })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (!Number.isFinite(DURATION_SCALE) || DURATION_SCALE <= 0) {
    throw new Error("LEADERBOARD_DURATION_SCALE must be greater than zero");
  }
}

function duration(seconds) {
  return seconds * DURATION_SCALE;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

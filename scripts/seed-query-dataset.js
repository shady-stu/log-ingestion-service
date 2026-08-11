const URL = process.env.QUERY_SEED_URL ?? "http://localhost:8080/logs";
const COUNT = Number(process.env.QUERY_SEED_COUNT ?? 100000);
const BATCH_SIZE = Number(process.env.QUERY_SEED_BATCH_SIZE ?? 1000);
const services = ["checkout", "inventory", "auth", "billing"];
const levels = ["debug", "info", "warn", "error"];
const regions = ["eu-west", "us-east", "ap-south"];
const start = Date.parse("2025-01-01T00:00:00.000Z");

async function run() {
  let accepted = 0;

  for (let offset = 0; offset < COUNT; offset += BATCH_SIZE) {
    const logs = Array.from(
      { length: Math.min(BATCH_SIZE, COUNT - offset) },
      (_, index) => createLog(offset + index)
    );
    const response = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logs }),
    });
    const body = await response.json();

    if (!response.ok || body.rejected?.length > 0) {
      throw new Error(`Seed failed: ${response.status} ${JSON.stringify(body)}`);
    }

    accepted += body.accepted;
  }

  console.log({ accepted });
}

function createLog(index) {
  const service = services[index % services.length];
  const level = levels[Math.floor(index / services.length) % levels.length];
  const region = regions[index % regions.length];
  const declined = index % 3 === 0;

  return {
    timestamp: new Date(start + (index % (30 * 24 * 60 * 60)) * 1000).toISOString(),
    level,
    service,
    message: declined ? "payment declined by bank" : "request succeeded",
    attributes: {
      user_id: index % 10000,
      region,
      retries: index % 5,
      success: !declined,
    },
  };
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

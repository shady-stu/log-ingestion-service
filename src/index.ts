import { server } from "./server";
import { registerRoutes } from "./api/routes/routes.js";
import { closeReadPool } from "./db/pool";
import { closeWriter, connectWriter } from "./db/writer";
import { writeCoordinator } from "./services/write-coordinator";
import { runtimeConfig } from "./config/runtime-config";
import { retentionService } from "./services/retention.service";

let shuttingDown = false;

async function start() {
  try {
    await connectWriter();
    retentionService.start();
    await registerRoutes(server);

    await server.listen({
      port: runtimeConfig.port,
      host: "0.0.0.0",
    });

    console.log(`Server running on port ${runtimeConfig.port}`);
  } catch (error) {
    server.log.error(error);
    await retentionService.stop().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);

  try {
    const closingServer = server.close();
    await retentionService.stop();
    await closingServer;
    await writeCoordinator.shutdown();
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed", error);
    process.exit(1);
  }
}

async function closeDatabase() {
  await closeWriter();
  await closeReadPool();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

start();

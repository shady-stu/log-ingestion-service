import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { databaseClientConfig } from "./config";

async function runMigrations(): Promise<void> {
  const migrationPool = new Pool({
    ...databaseClientConfig,
    max: 1,
  });

  try {
    await migrate(drizzle(migrationPool), {
      migrationsFolder: "./src/db/migrations",
    });
  } finally {
    await migrationPool.end();
  }
}

void runMigrations().catch((error) => {
  console.error("Database migration failed", error);
  process.exit(1);
});

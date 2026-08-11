import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL is not set");
}

const parsedDbUrl = new URL(dbUrl);

if (
  parsedDbUrl.protocol !== "postgresql:" ||
  parsedDbUrl.hostname !== "postgres" ||
  parsedDbUrl.port !== "5432" ||
  parsedDbUrl.pathname !== "/logs_db"
) {
  throw new Error(
    "DATABASE_URL must point to the internal postgres service and logs_db"
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
  verbose: true,
  strict: true,
});

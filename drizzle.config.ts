import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { DEFAULT_DATABASE_URL } from "./src/config/constants";

const dbUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

try {
  const parsedDbUrl = new URL(dbUrl);

  if (parsedDbUrl.protocol !== "postgresql:" && parsedDbUrl.protocol !== "postgres:") {
    throw new Error();
  }
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
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

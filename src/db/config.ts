import { type ClientConfig } from "pg";
import { runtimeConfig } from "../config/runtime-config";

export const databaseClientConfig: ClientConfig = {
  connectionString: runtimeConfig.databaseUrl,
  connectionTimeoutMillis: runtimeConfig.pgConnectionTimeoutMs,
};

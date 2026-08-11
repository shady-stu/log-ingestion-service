import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const logs = pgTable(
  "logs",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    level: text("level").notNull(),
    service: text("service").notNull(),
    message: text("message").notNull(),
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean>>()
      .notNull()
      .default({}),
  },
  (table) => ({
    timestampIdIdx: index("logs_timestamp_id_idx").on(table.timestamp, table.id),
    serviceTimestampIdIdx: index("logs_service_timestamp_id_idx")
      .on(table.service, table.timestamp, table.id),
    levelTimestampIdIdx: index("logs_level_timestamp_id_idx")
      .on(table.level, table.timestamp, table.id),
    serviceLevelTimestampIdx: index("logs_service_level_timestamp_idx")
      .on(table.service, table.level, table.timestamp, table.id),
  })
);

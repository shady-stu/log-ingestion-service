CREATE TABLE "logs" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (
        sequence name "logs_id_seq"
        INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START WITH 1
        CACHE 1
    ),
    "timestamp" timestamp with time zone NOT NULL,
    "level" text NOT NULL,
    "service" text NOT NULL,
    "message" text NOT NULL,
    "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL
);

--> statement-breakpoint

CREATE INDEX "logs_timestamp_id_idx"
ON "logs" USING btree ("timestamp","id");

--> statement-breakpoint

CREATE INDEX "logs_service_timestamp_id_idx"
ON "logs" USING btree ("service","timestamp","id");

--> statement-breakpoint

CREATE INDEX "logs_level_timestamp_id_idx"
ON "logs" USING btree ("level","timestamp","id");

--> statement-breakpoint

CREATE INDEX "logs_service_level_timestamp_idx"
ON "logs" USING btree ("service","level","timestamp","id");

--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS pg_trgm;

--> statement-breakpoint

CREATE INDEX "logs_attributes_gin_idx"
ON "logs"
USING GIN ("attributes");

--> statement-breakpoint

CREATE INDEX "logs_message_trgm_idx"
ON "logs"
USING GIN ("message" gin_trgm_ops);

--> statement-breakpoint

ALTER TABLE "logs"
ADD CONSTRAINT "logs_level_check"
CHECK ("level" IN ('debug', 'info', 'warn', 'error'));

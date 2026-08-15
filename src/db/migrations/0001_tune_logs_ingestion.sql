ALTER SEQUENCE "logs_id_seq" CACHE 20000;

--> statement-breakpoint

ALTER TABLE "logs" SET (
    autovacuum_vacuum_insert_threshold = 1000000,
    autovacuum_analyze_threshold = 1000000
);

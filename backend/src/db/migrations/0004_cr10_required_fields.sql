-- CR-10: required ticket fields + the Start/End schedule window.
--
-- Order matters: every backfill runs BEFORE its NOT NULL constraint, and the
-- legacy due_date column becomes start_date (its values are the original due
-- dates) while end_date backfills to the due date (or created_at as a floor).
ALTER TABLE "Tickets" ADD COLUMN "end_date" timestamptz;--> statement-breakpoint
UPDATE "Tickets" SET "description" = '' WHERE "description" IS NULL;--> statement-breakpoint
UPDATE "Tickets" SET "end_date" = COALESCE("due_date", "created_at");--> statement-breakpoint
UPDATE "Tickets" SET "end_date" = "created_at" WHERE "end_date" < "created_at";--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "Tickets" RENAME COLUMN "due_date" TO "start_date";--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "end_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "start_date" SET NOT NULL;

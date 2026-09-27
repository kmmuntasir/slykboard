-- CR-10: required ticket fields + the Start/End schedule window.
--
-- Order matters: every backfill runs BEFORE its NOT NULL constraint, and the
-- legacy due_date column becomes start_date. Legacy rows are backfilled so the
-- NOT NULL constraints hold on EXISTING data, not just on new inserts:
--   - description: NULL -> '' (empty legacy descriptions stay editable; only
--     the create path requires a non-empty one).
--   - start/end: a row's due date (when set) anchors BOTH ends, so the app's
--     "end must be after start" rule always holds; rows with no due date fall
--     back to a 1-day window starting at created_at.
ALTER TABLE "Tickets" ADD COLUMN "end_date" timestamptz;--> statement-breakpoint
UPDATE "Tickets" SET "description" = '' WHERE "description" IS NULL;--> statement-breakpoint
UPDATE "Tickets" SET "end_date" = COALESCE("due_date", "created_at", now());--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "Tickets" RENAME COLUMN "due_date" TO "start_date";--> statement-breakpoint
UPDATE "Tickets" SET "start_date" = COALESCE("start_date", "created_at", now());--> statement-breakpoint
UPDATE "Tickets" SET "end_date" = "start_date" + interval '1 day' WHERE "end_date" <= "start_date";--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Tickets" ALTER COLUMN "end_date" SET NOT NULL;

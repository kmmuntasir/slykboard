ALTER TYPE "public"."ActivityAction" ADD VALUE 'TIME_ADJUSTED';--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD COLUMN "adjustment_minutes" integer;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD COLUMN "adjustment_reason" text;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD COLUMN "adjusted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD COLUMN "adjusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_adjusted_by_id_Users_id_fk" FOREIGN KEY ("adjusted_by_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;
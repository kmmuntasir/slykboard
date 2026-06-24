CREATE TABLE "TimeEntries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"manual_entry_minutes" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_active" ON "TimeEntries" USING btree ("user_id") WHERE "TimeEntries"."end_time" IS NULL;
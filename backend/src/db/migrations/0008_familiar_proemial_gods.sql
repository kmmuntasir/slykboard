CREATE TYPE "public"."ActivityAction" AS ENUM('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED', 'LABELS_CHANGED', 'CONTENT_UPDATED');--> statement-breakpoint
CREATE TABLE "ActivityLogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid,
	"action_type" "ActivityAction" NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ActivityLogs" ADD CONSTRAINT "ActivityLogs_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ActivityLogs" ADD CONSTRAINT "ActivityLogs_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_ticket_id_idx" ON "ActivityLogs" USING btree ("ticket_id");
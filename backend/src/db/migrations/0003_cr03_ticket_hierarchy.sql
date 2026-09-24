CREATE TYPE "public"."TicketType" AS ENUM('EPIC', 'STORY', 'TASK', 'SUBTASK');--> statement-breakpoint
ALTER TYPE "public"."ActivityAction" ADD VALUE 'PARENT_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."ActivityAction" ADD VALUE 'TYPE_CHANGED';--> statement-breakpoint
ALTER TABLE "Tickets" ADD COLUMN "type" "TicketType" DEFAULT 'TASK' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tickets" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_parent_id_Tickets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."Tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_parent_id_idx" ON "Tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tickets_project_type_idx" ON "Tickets" USING btree ("project_id","type");
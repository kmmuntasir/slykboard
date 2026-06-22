CREATE TYPE "public"."Priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "Tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status_column" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"assignee_id" uuid,
	"creator_id" uuid NOT NULL,
	"priority" "Priority" DEFAULT 'MEDIUM' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_assignee_id_Users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_creator_id_Users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."ActivityAction" AS ENUM('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED', 'LABELS_CHANGED', 'CONTENT_UPDATED');--> statement-breakpoint
CREATE TYPE "public"."Priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."ProjectMemberRole" AS ENUM('PROJECT_ADMIN', 'MEMBER');--> statement-breakpoint
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
CREATE TABLE "Labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "ProjectMemberRole" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_sequences" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"columns" jsonb NOT NULL,
	"creator_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "TicketLabels" (
	"ticket_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "TicketLabels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
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
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tickets_project_number_uq" UNIQUE("project_id","ticket_number")
);
--> statement-breakpoint
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
CREATE TABLE "Users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ActivityLogs" ADD CONSTRAINT "ActivityLogs_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ActivityLogs" ADD CONSTRAINT "ActivityLogs_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Labels" ADD CONSTRAINT "Labels_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sequences" ADD CONSTRAINT "project_sequences_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_creator_id_Users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TicketLabels" ADD CONSTRAINT "TicketLabels_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TicketLabels" ADD CONSTRAINT "TicketLabels_label_id_Labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."Labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_assignee_id_Users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_creator_id_Users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_ticket_id_idx" ON "ActivityLogs" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_project_name_uniq" ON "Labels" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_labels_label_id_idx" ON "TicketLabels" USING btree ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_active" ON "TimeEntries" USING btree ("user_id") WHERE "TimeEntries"."end_time" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_uniq" ON "Users" USING btree ("google_id");
ALTER TYPE "public"."ActivityAction" ADD VALUE 'COMMENT_EDITED';--> statement-breakpoint
ALTER TYPE "public"."ActivityAction" ADD VALUE 'COMMENT_DELETED';--> statement-breakpoint
CREATE TABLE "Comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_author_id_Users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_ticket_id_idx" ON "Comments" USING btree ("ticket_id");
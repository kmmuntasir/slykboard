CREATE TABLE "Projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"columns" jsonb NOT NULL,
	"creator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_creator_id_Users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;
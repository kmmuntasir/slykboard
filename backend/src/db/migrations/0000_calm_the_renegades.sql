CREATE TYPE "public"."Role" AS ENUM('ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "Users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"avatar_url" text,
	"role" "Role" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "Users_email_unique" UNIQUE("email")
);

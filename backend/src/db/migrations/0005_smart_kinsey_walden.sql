CREATE TABLE "project_sequences" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_sequences" ADD CONSTRAINT "project_sequences_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- F12: backfill project_sequences for pre-existing projects (F08/F09 projects
-- have tickets with explicit numbers; nextNumber = max(existing) + 1, or START).
INSERT INTO "project_sequences" ("project_id", "next_number")
SELECT p."id",
       COALESCE((SELECT MAX(t."ticket_number") FROM "Tickets" t WHERE t."project_id" = p."id"), 0) + 1
FROM "Projects" p
ON CONFLICT ("project_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "Tickets" ADD CONSTRAINT "tickets_project_number_uq" UNIQUE("project_id","ticket_number");
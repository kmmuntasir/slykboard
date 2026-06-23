CREATE TABLE "Labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TicketLabels" (
	"ticket_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "TicketLabels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "Labels" ADD CONSTRAINT "Labels_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TicketLabels" ADD CONSTRAINT "TicketLabels_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TicketLabels" ADD CONSTRAINT "TicketLabels_label_id_Labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."Labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_project_name_uniq" ON "Labels" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "ticket_labels_label_id_idx" ON "TicketLabels" USING btree ("label_id");--> statement-breakpoint

-- F14 T1 backfill: migrate "Tickets"."labels" jsonb string[] -> Labels + TicketLabels rows.
-- Per project, dedupe distinct label strings via unique (project_id, name) index.
-- Default color #6B7280 (gray-500) — matches TicketLabelChip fallback. ON CONFLICT DO NOTHING
-- makes this idempotent and safe to re-run.
INSERT INTO "Labels" ("project_id", "name", "color", "created_at", "updated_at")
SELECT DISTINCT t."project_id", elem AS "name", '#6B7280' AS "color", NOW(), NOW()
FROM "Tickets" t
CROSS JOIN LATERAL jsonb_array_elements_text(t."labels") AS elem
ON CONFLICT DO NOTHING;

-- Link tickets to their backfilled labels via the join table.
-- CROSS JOIN LATERAL (not implicit comma-join) so `t` is in scope for the
-- subsequent JOIN ON clause — mixing comma and JOIN puts `t` out of scope.
INSERT INTO "TicketLabels" ("ticket_id", "label_id", "assigned_at")
SELECT t."id", l."id", NOW()
FROM "Tickets" t
CROSS JOIN LATERAL jsonb_array_elements_text(t."labels") AS elem
JOIN "Labels" l ON l."project_id" = t."project_id" AND l."name" = elem
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "Tickets" DROP COLUMN "labels";
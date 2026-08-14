CREATE TYPE "public"."MessageAuthorRole" AS ENUM('PM', 'AGENT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."OnboardingState" AS ENUM('PENDING', 'PROVISIONING_LXC', 'WIRING_GITHUB', 'WIRING_AGENT', 'WIRING_ZORAXY', 'SMOKE_TEST', 'LIVE', 'FAILED', 'DECOMMISSIONING', 'DECOMMISSIONED');--> statement-breakpoint
CREATE TYPE "public"."PipelineState" AS ENUM('BACKLOG', 'QUEUED', 'AGENT_RUNNING', 'AGENT_WAITING', 'PR_OPEN', 'CI_RUNNING', 'MERGING', 'CONFLICT_RETRY', 'DEPLOYING', 'DONE', 'FAILED_AGENT', 'FAILED_CI', 'FAILED_CONFLICT', 'FAILED_DEPLOY', 'BLOCKED_HUMAN');--> statement-breakpoint
CREATE TABLE "AgentMessages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_role" "MessageAuthorRole" NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"agent_session_id" text,
	"idempotency_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentTokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"project_id" uuid,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AgentTokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "NotificationPreferences" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"notify_on_done" boolean DEFAULT true NOT NULL,
	"notify_on_blocked_human" boolean DEFAULT true NOT NULL,
	"notify_on_agent_waiting" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "NotificationPreferences_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "OnboardingEvents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_state" "OnboardingState",
	"to_state" "OnboardingState" NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PipelineEvents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"from_state" "PipelineState",
	"to_state" "PipelineState" NOT NULL,
	"detail" jsonb,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PipelineJobs" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"state" "PipelineState" DEFAULT 'BACKLOG' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner_id" text,
	"lease_expires_at" timestamp with time zone,
	"agent_issue_id" text,
	"agent_backend" text,
	"github_pr_number" integer,
	"github_pr_sha" text,
	"needs_pm_attention" boolean DEFAULT false NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProjectAgentMeta" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"subdomain" text NOT NULL,
	"source_mode" text DEFAULT 'new' NOT NULL,
	"github_repo" text,
	"github_repo_created" boolean DEFAULT false NOT NULL,
	"stack" text NOT NULL,
	"team_key" text NOT NULL,
	"agent_backend" text,
	"initial_agent_context" text,
	"lxc_ctid" integer,
	"lan_ip" text,
	"systemd_service" text,
	"zoraxy_proxy_id" text,
	"onboarding_state" "OnboardingState" DEFAULT 'PENDING' NOT NULL,
	"onboarding_error" text,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ProjectAgentMeta_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "AgentMessages" ADD CONSTRAINT "AgentMessages_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentMessages" ADD CONSTRAINT "AgentMessages_author_user_id_Users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentTokens" ADD CONSTRAINT "AgentTokens_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentTokens" ADD CONSTRAINT "AgentTokens_created_by_Users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_user_id_Users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OnboardingEvents" ADD CONSTRAINT "OnboardingEvents_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PipelineEvents" ADD CONSTRAINT "PipelineEvents_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PipelineJobs" ADD CONSTRAINT "PipelineJobs_ticket_id_Tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."Tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PipelineJobs" ADD CONSTRAINT "PipelineJobs_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProjectAgentMeta" ADD CONSTRAINT "ProjectAgentMeta_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."Projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_messages_ticket_created" ON "AgentMessages" USING btree (ticket_id, created_at);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_messages_idempotency" ON "AgentMessages" USING btree (idempotency_key) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_onboarding_events_project_created" ON "OnboardingEvents" USING btree (project_id, created_at);--> statement-breakpoint
CREATE INDEX "idx_pipeline_events_ticket_created" ON "PipelineEvents" USING btree (ticket_id, created_at);--> statement-breakpoint
CREATE INDEX "idx_pipeline_jobs_state_lease" ON "PipelineJobs" USING btree (state, lease_expires_at, priority DESC, created_at);--> statement-breakpoint
CREATE INDEX "idx_pipeline_jobs_needs_pm_attention" ON "PipelineJobs" USING btree (needs_pm_attention) WHERE needs_pm_attention = true;
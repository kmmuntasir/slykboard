import { z } from 'zod';

// SLYK-0280 — route shapes for /api/v1/me (user-facing agent-mode routes,
// docs/agentic-automation/05-backend-routes.md § /api/v1/me/*). The pipeline
// GET is param-only; chat body schemas (messages POST) land with Phase 2.

// Note: the doc's path param is `:id`, but every existing ticket-keyed route
// uses `ticketId` (tickets.schema.ts ticketIdParam) so middleware and handlers
// read one consistent param name. Same shape, different key.
export const ticketIdParam = z.object({
  ticketId: z.uuid(),
});

export type TicketIdParam = z.infer<typeof ticketIdParam>;

// SLYK-0330 — PM chat-reply body (05-backend-routes.md § me/tickets/:id/messages
// POST: "body — non-empty, ≤4000 chars"). Same 1..4000 span as the dispatcher's
// agentMessageBody in internal.schema.ts so both chat directions agree.
export const pmReplyBody = z.object({
  body: z.string().min(1).max(4000),
});

export type PmReplyBody = z.infer<typeof pmReplyBody>;

// SLYK-0230 — onboarding-timeline read (06-frontend-ui.md § Onboarding
// Timeline). Same kebab-slug shape as admin-agent.schema.ts slugParam.
export const onboardingSlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

export type OnboardingSlugParam = z.infer<typeof onboardingSlugParam>;

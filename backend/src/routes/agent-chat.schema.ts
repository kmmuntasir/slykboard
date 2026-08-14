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

import { z } from 'zod';
import { onboardingStateEnum } from '../db/schema';

// SLYK-0150 — route-shape placeholders for /api/v1/internal (dispatcher
// callbacks). Full Zod validation lands with the real handlers; the param
// shapes are final (they match the mounted paths in internal.routes.ts).
// Shapes per docs/agentic-automation/05-backend-routes.md.
// SLYK-0200 adds the onboarding-events body schema (deploy-target is a
// param-only GET — no body schema needed).

export const ticketIdParam = z.object({
  ticketId: z.uuid(),
});

export const slugParam = z.object({
  slug: z.string().min(1),
});

// Validated against the DB enum so API + schema can never drift.
export const onboardingStateSchema = z.enum(onboardingStateEnum.enumValues);

export const onboardingEventBody = z.object({
  fromState: onboardingStateSchema.nullable(),
  toState: onboardingStateSchema,
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type TicketIdParam = z.infer<typeof ticketIdParam>;
export type SlugParam = z.infer<typeof slugParam>;
export type OnboardingEventBody = z.infer<typeof onboardingEventBody>;

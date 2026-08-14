import { z } from 'zod';

// SLYK-0150 — route-shape placeholders for /api/v1/admin (admin UI actions).
// Full Zod validation lands with the real handlers; the param shapes are
// final (they match the mounted paths in admin-agent.routes.ts). Shapes per
// docs/agentic-automation/05-backend-routes.md.

export const slugParam = z.object({
  slug: z.string().min(1),
});

export type SlugParam = z.infer<typeof slugParam>;

import { z } from 'zod';

// F08 D-Slug-Format: validated server-side again (service also normalizes+checks).
// Accepts the raw input here; service normalizes. Lenient on case so 'slyk' is accepted then normalized.
export const createProjectBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be ≤100 chars'),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, 'Slug must be alphanumeric (letters, digits, space, _, -)'),
  columns: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(50),
      }),
    )
    .min(1, 'At least one column is required')
    .max(20, 'Too many columns (max 20)')
    .optional(),
});

// F08 D-Slug-Format: URL is the normalized form — strict uppercase only.
export const slugParamSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z][A-Z0-9]{1,15}$/, 'Invalid slug'),
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

// F12 D-Ticket-Create: body for POST /:slug/tickets. statusColumn is validated
// against the project's columns in the service (needs the project to be loaded first).
// F14: labelIds widened to uuid().array() (label catalog IDs, not free-text).
// Renamed labels -> labelIds for symmetry with updateTicketBody + createTicket input.
export const createTicketBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']).optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  assigneeId: z.uuid().optional(),
  statusColumn: z.string().min(1).optional(),
});

export type CreateTicketBody = z.infer<typeof createTicketBody>;

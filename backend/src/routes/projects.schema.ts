import { z } from 'zod';
import { checklistItemSchema, TICKET_DESCRIPTION_MAX_LENGTH } from './tickets.schema';

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

// F27 T2: PATCH /:slug body. name and/or columns; slug is NOT editable.
// min(1) columns enforces "at least one column"; per-column ids must be stable uuids.
// CR-01: the columns array contract is shared with updateProjectColumnsBodySchema
// (the Project-Admin column-management endpoint), so it lives here as a named const.
export const projectColumnsSchema = z
  .array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(50) }))
  .min(1, 'At least one column is required')
  .refine((cols) => new Set(cols.map((c) => c.id)).size === cols.length, {
    message: 'Column ids must be unique',
  });

export const updateProjectBodySchema = z.object({
  name: z.string().min(1, 'Name must be ≥1 char').max(100, 'Name must be ≤100 chars').optional(),
  columns: projectColumnsSchema.optional(),
  // DEL-04: activation toggle. Only boolean values are accepted; a string like
  // 'true' must be rejected by validateRequest (400). undefined means "don't touch".
  isActive: z.boolean().optional(),
});

export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

// CR-01 (docs/change-requests-requirements.md): PATCH /:slug/columns body —
// columns ONLY, required. Project rename and activation stay on the PA-only
// PATCH /:slug (FR-01.4); unknown keys (name/isActive) are stripped by Zod so
// a Project Admin cannot smuggle them through this endpoint.
export const updateProjectColumnsBodySchema = z.object({
  columns: projectColumnsSchema,
});

export type UpdateProjectColumnsBody = z.infer<typeof updateProjectColumnsBodySchema>;

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

// F12 D-Ticket-Create: body for POST /:slug/tickets. statusColumn is validated
// against the project's columns in the service (needs the project to be loaded first).
// F14: labelIds widened to uuid().array() (label catalog IDs, not free-text).
// Renamed labels -> labelIds for symmetry with updateTicketBody + createTicket input.
// CR-10: every create input is REQUIRED with no server default — title,
// description (non-empty), status, priority, and the Start/End window. The
// window rule (end after start) is enforced by the schema superRefine below.
export const createTicketBody = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1, 'Description is required').max(TICKET_DESCRIPTION_MAX_LENGTH),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    labelIds: z.array(z.string().uuid()).optional(),
    assigneeId: z.uuid().optional(),
    statusColumn: z.string().min(1),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    // F15: optional checklist at create time. Defaults to [] via the DB column
    // when omitted; validated with the same sub-schema as the PATCH path.
    checklist: z.array(checklistItemSchema).max(50).optional(),
    // CR-03: hierarchy fields. Rank rules + subtask-needs-parent are enforced in
    // ticketService (assertHierarchyRules) inside the creation transaction.
    type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK']).optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (new Date(body.endDate).getTime() <= new Date(body.startDate).getTime()) {
      ctx.addIssue({
        code: 'custom',
        message: 'End date must be after the start date',
        path: ['endDate'],
      });
    }
  });

export type CreateTicketBody = z.infer<typeof createTicketBody>;

// F30 D5: params for GET /:slug/tickets/:displayId (human-readable ticket URL).
// Zod only enforces slug shape (inherited from slugParamSchema) and that the
// displayId is a non-empty string. The full displayId FORMAT validation + the
// 404 (not 400) for a malformed ref happen in the route handler via
// parseTicketDisplayId — D5 deliberately treats 'SLYK-abc' as NOT_FOUND so a
// guessable wrong ID is indistinguishable from a real miss.
export const ticketDisplayIdParamSchema = slugParamSchema.extend({
  displayId: z.string().min(1),
});

export type TicketDisplayIdParam = z.infer<typeof ticketDisplayIdParamSchema>;

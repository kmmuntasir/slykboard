import { z } from 'zod';

export const ticketIdParam = z.object({
  ticketId: z.uuid(),
});

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']);

// F13: merged PATCH body — F11 move fields (preserved) + F13 attribute fields.
// Any non-empty subset is accepted. superRefine enforces two invariants:
//   1) body is non-empty (at least one field set)
//   2) F11 invariant: statusColumn and position come as a pair — the move-only
//      path in ticketService needs both. Attribute fields are independent.
const moveFields = {
  statusColumn: z.string().min(1).optional(),
  position: z.number().finite().optional(),
};

// F15: checklist sub-item shape. id is a client-generated UUID
// (crypto.randomUUID); validated as uuid() here. Text capped 200 (title parity),
// max 50 items. Whole array is replaced on every save (last-write-wins, D4).
// Exported so the create-ticket body (projects.schema) reuses the same shape.
export const checklistItemSchema = z.object({
  id: z.uuid(),
  text: z.string().min(1).max(200),
  done: z.boolean(),
});

const attributeFields = {
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(), // F14: replace ticket's label set
  checklist: z.array(checklistItemSchema).max(50).optional(), // F15: replace checklist array
  // T1: optional due date (ISO 8601 datetime). null clears it; absent = untouched.
  dueDate: z.string().datetime().nullable().optional(),
};

export const updateTicketBody = z
  .object({ ...moveFields, ...attributeFields })
  .superRefine((body, ctx) => {
    if (Object.keys(body).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Body must include at least one field',
      });
      return;
    }
    const hasStatus = body.statusColumn !== undefined;
    const hasPos = body.position !== undefined;
    if (hasStatus !== hasPos) {
      ctx.addIssue({
        code: 'custom',
        message: 'statusColumn and position must both be present when moving',
        path: [hasStatus ? 'position' : 'statusColumn'],
      });
    }
  });

export type TicketIdParam = z.infer<typeof ticketIdParam>;
export type UpdateTicketBody = z.infer<typeof updateTicketBody>;

// F21 §9.5: manual time entry body. minutes capped at 1440 (24h) — a single
// entry longer than a day is almost always a data-entry mistake.
export const manualEntryBody = z.object({
  minutes: z.number().int().min(1).max(1440),
  description: z.string().max(500).optional(),
});

export type ManualEntryBody = z.infer<typeof manualEntryBody>;

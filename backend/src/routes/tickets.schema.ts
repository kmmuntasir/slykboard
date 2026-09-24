import { z } from 'zod';

// DEL-03: single source of truth for the ticket description char cap.
// Applied on both the PATCH (attributeFields) and POST (createTicketBody) paths.
export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;

export const ticketIdParam = z.object({
  ticketId: z.uuid(),
});

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']);

function assertWindowOrder(
  startDate: string | undefined,
  endDate: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!startDate || !endDate) return;
  if (new Date(endDate).getTime() <= new Date(startDate).getTime()) {
    ctx.addIssue({
      code: 'custom',
      message: 'End date must be after the start date',
      path: ['endDate'],
    });
  }
}

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
  // CR-10: required field — editable but never cleared (null rejected).
  description: z.string().max(TICKET_DESCRIPTION_MAX_LENGTH).optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(), // F14: replace ticket's label set
  checklist: z.array(checklistItemSchema).max(50).optional(), // F15: replace checklist array
  // CR-10: schedule window on PATCH. Optional per-patch (a move-only or
  // attribute-only patch doesn't resend them) but NOT nullable — a required
  // field may be changed, never cleared. endDate is the due date.
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  // CR-03: hierarchy fields. type change is validated against the current
  // parent AND live children in the service; parentId null = detach to root
  // (rejected for SUBTASK by the service).
  type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK']).optional(),
  parentId: z.string().uuid().nullable().optional(),
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
    assertWindowOrder(body.startDate, body.endDate, ctx);
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

// CR-14: adjustment payload — signed whole minutes (non-zero) + a mandatory
// reason (min length mirrors the service guard).
export const adjustmentBody = z.object({
  adjustmentMinutes: z
    .number()
    .int()
    .refine((m) => m !== 0, {
      message: 'Adjustment must be a non-zero whole number of minutes',
    }),
  reason: z.string().min(10, 'A reason of at least 10 characters is required').max(500),
});

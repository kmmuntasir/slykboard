import { useMemo, useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TICKET_TYPE_RANK, type TicketType } from '@/types/ticket';

// DEL-01 T6: shared React Hook Form instance for the ticket attributes form.
// Owns the single RHF setup (zodResolver + schema + defaultValues + dirty-hoist)
// so both the create flow (TicketAttributeForm) and the edit flow
// (TicketDetailModal) compose the SAME field components inside one
// <FormProvider>.

// DEL-03 T2: unified description length ceiling (10_000) shared by create + edit.
export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;

const baseTicketFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 chars or fewer'),
  // CR-10: description is required on create (mode-aware below); an empty
  // string stays valid so legacy tickets remain editable.
  description: z
    .string()
    .max(
      TICKET_DESCRIPTION_MAX_LENGTH,
      `Description must be ${TICKET_DESCRIPTION_MAX_LENGTH} chars or fewer`,
    ),
  // CR-10: no MEDIUM default — the create flow requires an explicit pick.
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']).nullable(),
  assigneeId: z.string().uuid().nullable(),
  labelIds: z.array(z.string().uuid()).default([]),
  checklist: z
    .array(
      z.object({
        id: z.string().uuid(),
        text: z.string().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(50)
    .default([]),
  // Status is bound to the project's columns (expose-only on edit; routed via
  // moveTicket there, persisted directly at create).
  statusColumn: z.string(),
  // CR-10: required schedule window (ISO datetimes). endDate is the due date.
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  // CR-03: hierarchy fields.
  type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK']),
  parentId: z.string().uuid().nullable(),
});

/**
 * CR-03: hierarchy rules. A subtask must have a parent; rank ordering is
 * enforced server-side (the parent picker only offers eligible tickets).
 */
function addHierarchyIssue(
  values: { type: TicketType; parentId: string | null },
  ctx: z.RefinementCtx,
): void {
  if (values.type === 'SUBTASK' && !values.parentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A subtask must have a parent ticket',
      path: ['parentId'],
    });
  }
}

/** CR-10: the schedule window is required and ordered on every submit. */
function addWindowIssues(
  values: { startDate: string | null; endDate: string | null },
  ctx: z.RefinementCtx,
): void {
  if (!values.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Start is required',
      path: ['startDate'],
    });
  }
  if (!values.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End (due) is required',
      path: ['endDate'],
    });
  } else if (values.startDate && new Date(values.endDate) <= new Date(values.startDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End (due) must be after the start',
      path: ['endDate'],
    });
  }
}

/** Mode-aware ticket form schema (CR-10 create strictness). */
export function makeTicketFormSchema(opts: {
  requireDescription: boolean;
  requirePriority: boolean;
}) {
  return baseTicketFormSchema.superRefine((values, ctx) => {
    addHierarchyIssue(values, ctx);
    addWindowIssues(values, ctx);
    if (opts.requireDescription && values.description.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Description is required',
        path: ['description'],
      });
    }
    if (opts.requirePriority && values.priority === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Priority is required',
        path: ['priority'],
      });
    }
  });
}

/** Default instance (edit-mode strictness) — used by tests and direct callers. */
export const ticketFormSchema = makeTicketFormSchema({
  requireDescription: false,
  requirePriority: false,
});

export type TicketFormValues = z.infer<typeof ticketFormSchema>;

export interface UseTicketFormArgs {
  defaultValues: TicketFormValues;
  /**
   * Submit handler. Hosts bind it via the returned `methods.handleSubmit(onSubmit)`
   * so the RHF validation gate (zodResolver) runs before values reach the host.
   */
  onSubmit: (values: TicketFormValues) => void | Promise<void>;
  /** F16: surface dirty state to the host so it can guard close/navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** CR-10: the CREATE flow requires a non-empty description and an explicit
   *  priority pick; the edit flow tolerates legacy empty descriptions. */
  requireDescription?: boolean;
  requirePriority?: boolean;
}

export function useTicketForm({
  defaultValues,
  onDirtyChange,
  requireDescription = false,
  requirePriority = false,
}: UseTicketFormArgs): UseFormReturn<TicketFormValues> {
  const schema = useMemo(
    () => makeTicketFormSchema({ requireDescription, requirePriority }),
    [requireDescription, requirePriority],
  );
  const methods = useForm<TicketFormValues>({
    // zod@3.25 output widened; resolver lib expects narrower shape. Cast bridges gap.
    resolver: zodResolver(schema as never),
    defaultValues,
  });

  // F16: hoist dirty state so the host can guard close/navigation.
  const isDirty = methods.formState.isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  return methods;
}

// CR-03: eligible parents for a ticket of the given type — every live ticket
// in the project whose type STRICTLY outranks it (rank rule mirror). Exported
// for the ParentField select and for testability.
export function eligibleParents(
  allTickets: ReadonlyArray<{
    id: string;
    title: string;
    ticketNumber: number;
    type: TicketType;
  }>,
  type: TicketType,
): Array<{ id: string; title: string; ticketNumber: number; type: TicketType }> {
  const rank = TICKET_TYPE_RANK[type];
  return allTickets.filter((candidate) => TICKET_TYPE_RANK[candidate.type] > rank);
}

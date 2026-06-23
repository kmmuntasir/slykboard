import { z } from 'zod'

export const ticketIdParam = z.object({
    ticketId: z.uuid(),
})

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'])

// F13: merged PATCH body — F11 move fields (preserved) + F13 attribute fields.
// Any non-empty subset is accepted. superRefine enforces two invariants:
//   1) body is non-empty (at least one field set)
//   2) F11 invariant: statusColumn and position come as a pair — the move-only
//      path in ticketService needs both. Attribute fields are independent.
const moveFields = {
    statusColumn: z.string().min(1).optional(),
    position: z.number().finite().optional(),
}

const attributeFields = {
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: priorityEnum.optional(),
    assigneeId: z.uuid().nullable().optional(),
}

export const updateTicketBody = z
    .object({ ...moveFields, ...attributeFields })
    .superRefine((body, ctx) => {
        if (Object.keys(body).length === 0) {
            ctx.addIssue({
                code: 'custom',
                message: 'Body must include at least one field',
            })
            return
        }
        const hasStatus = body.statusColumn !== undefined
        const hasPos = body.position !== undefined
        if (hasStatus !== hasPos) {
            ctx.addIssue({
                code: 'custom',
                message: 'statusColumn and position must both be present when moving',
                path: [hasStatus ? 'position' : 'statusColumn'],
            })
        }
    })

export type TicketIdParam = z.infer<typeof ticketIdParam>
export type UpdateTicketBody = z.infer<typeof updateTicketBody>

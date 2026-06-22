import { z } from 'zod'

// F11 D2: generic PATCH /api/tickets/:ticketId path param (uuid). F13 widens the body later.
export const ticketIdParam = z.object({
    ticketId: z.uuid(),
})

// F11 D2: move = { statusColumn (Column.id text), position (finite double). }
// Column-membership + UNSORTED_BUCKET_ID rejection enforced in ticketService (needs project context).
export const moveTicketBody = z.object({
    statusColumn: z.string().min(1),
    position: z.number().finite(),
})

export type TicketIdParam = z.infer<typeof ticketIdParam>
export type MoveTicketBody = z.infer<typeof moveTicketBody>

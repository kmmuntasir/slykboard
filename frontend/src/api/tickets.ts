import { apiFetch } from './client';
import type { Ticket, UpdateTicketDto } from '../types/ticket';

export interface MoveTicketRequest {
  statusColumn: string;
  position: number;
}

export function moveTicket(ticketId: string, dto: MoveTicketRequest): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// F12 T5: createTicket — POST /projects/:slug/tickets. apiFetch unwraps {data}.
export interface CreateTicketDto {
  title: string;
  description?: string;
  priority?: Ticket['priority'];
  labels?: string[];
  assigneeId?: string;
  statusColumn?: string;
}

export function createTicket(slug: string, dto: CreateTicketDto): Promise<Ticket> {
  return apiFetch<Ticket>(`/projects/${slug}/tickets`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// F13 T9: GET /tickets/:id — fetch full ticket for the attributes drawer.
export async function fetchTicket(ticketId: string): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${ticketId}`);
}

// F13 T9: PATCH /tickets/:id — write attribute edits (title/description/priority/assigneeId).
export async function updateTicket(
  ticketId: string,
  dto: UpdateTicketDto,
): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

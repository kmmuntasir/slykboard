import { apiFetch } from './client';
import type { Ticket } from '../types/ticket';

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

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

import { apiFetch } from './client';
import type { ChecklistItem, Ticket, UpdateTicketDto } from '../types/ticket';
import type { ActivityResponse } from '../types/activity';

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
// F14 T5: labels (string[]) replaced by labelIds (uuid[]) referencing the catalog.
export interface CreateTicketDto {
  title: string;
  description?: string;
  priority?: Ticket['priority'];
  labelIds?: string[];
  assigneeId?: string;
  statusColumn?: string;
  checklist?: ChecklistItem[]; // F15: optional checklist at create; DB defaults to []
  dueDate?: string | null; // DEL-01: nullable ISO datetime at create
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

// F30 T3: GET /projects/:slug/tickets/:displayId — resolve a human-readable
// SLYK-NNN ref to the full Ticket (used by the deep-link route layer). Modal
// still resolves UUID-keyed detail via fetchTicket — kept separate here to
// avoid a second round-trip (the route seeds the UUID cache via setQueryData).
export async function fetchTicketByRef(slug: string, displayId: string): Promise<Ticket> {
  return apiFetch<Ticket>(`/projects/${slug}/tickets/${displayId}`);
}

// F13 T9: PATCH /tickets/:id — write attribute edits (title/description/priority/assigneeId).
export async function updateTicket(ticketId: string, dto: UpdateTicketDto): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// F17 T3: DELETE /tickets/:id — admin-only soft-delete. Server returns 204 with
// an empty body; apiFetch's 204 guard resolves to null. Promise<void> at call site.
export async function deleteTicket(ticketId: string): Promise<void> {
  await apiFetch<void>(`/tickets/${ticketId}`, { method: 'DELETE' });
}

// F19 T3: GET /tickets/:id/activity — render-ready enriched activity rows.
export async function fetchTicketActivity(ticketId: string): Promise<ActivityResponse> {
  return apiFetch<ActivityResponse>(`/tickets/${ticketId}/activity`);
}

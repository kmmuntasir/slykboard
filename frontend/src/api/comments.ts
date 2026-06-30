import { apiFetch } from './client';
import type { CommentDto } from '../types/comment';

// SLYK-13 T9: ticket-comment HTTP client.
// Reads:  GET    /tickets/:ticketId/comments   -> CommentDto[]
// Create: POST   /tickets/:ticketId/comments   -> CommentDto
// Update: PATCH  /comments/:commentId          -> CommentDto
// Delete: DELETE /comments/:commentId          -> 204 (apiFetch resolves null)
//
// apiFetch unwraps the { data } envelope, sets Accept/Content-Type/Authorization
// headers, and throws ApiClientError on !ok — so these stay thin, matching the
// conventions in tickets.ts / labels.ts.

export async function fetchTicketComments(ticketId: string): Promise<CommentDto[]> {
  return apiFetch<CommentDto[]>(`/tickets/${ticketId}/comments`);
}

export async function createTicketComment(ticketId: string, body: string): Promise<CommentDto> {
  return apiFetch<CommentDto>(`/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function updateTicketComment(commentId: string, body: string): Promise<CommentDto> {
  return apiFetch<CommentDto>(`/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export async function deleteTicketComment(commentId: string): Promise<void> {
  await apiFetch<void>(`/comments/${commentId}`, { method: 'DELETE' });
}

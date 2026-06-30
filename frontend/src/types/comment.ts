// SLYK-13 T9: comment DTOs mirroring the backend CommentDto. ISO datetimes kept
// as `string` to match FE conventions (see types/ticket.ts, types/activity.ts).

// Comment author (resolved server-side). null-safe fields mirror ActivityActor.
export interface CommentAuthorDto {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

// Backend CommentDto: { id, ticketId, body, createdAt, updatedAt, edited, author }.
// `edited` is derived server-side (createdAt !== updatedAt); author is null-safe.
export interface CommentDto {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  edited: boolean;
  author: CommentAuthorDto;
}

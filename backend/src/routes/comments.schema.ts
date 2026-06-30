import { z } from 'zod';

export const commentIdParam = z.object({
  commentId: z.uuid(),
});

export const createCommentBody = z.object({
  body: z.string().min(1, { message: 'Comment body cannot be empty' }).max(5000, {
    message: 'Comment body cannot exceed 5000 characters',
  }),
});

export const updateCommentBody = z.object({
  body: z.string().min(1, { message: 'Comment body cannot be empty' }).max(5000, {
    message: 'Comment body cannot exceed 5000 characters',
  }),
});

export type CommentIdParam = z.infer<typeof commentIdParam>;
export type CreateCommentBody = z.infer<typeof createCommentBody>;
export type UpdateCommentBody = z.infer<typeof updateCommentBody>;

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { resolveCommentProject } from '../middleware/resolveProject';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import {
  commentIdParam,
  updateCommentBody,
  type CommentIdParam,
  type UpdateCommentBody,
} from './comments.schema';
import * as commentService from '../services/commentService';

// SLYK-13: flat comment mutation routes mounted at /api/comments. Both are
// guarded by resolveCommentProject() (T7) which loads the comment → its ticket
// → the ticket's project + membership, attaching req.user / req.project /
// req.projectMember and emitting the only NOT_FOUND this router produces for an
// unknown commentId (anti-oracle). Authorization:
//   PATCH — author-only, enforced IN THE SERVICE (updateComment throws FORBIDDEN
//           for a non-author; a null authorId can never match, so orphans are
//           uneditable). The route does not pre-check authorship.
//   DELETE — author OR Platform Admin OR Project Admin. Admin flags are derived
//            from req.user.isPlatformAdmin (set by `authenticate` from the JWT
//            `pa` claim) and req.projectMember === 'PROJECT_ADMIN' (set by the
//            resolver); the final author/admin decision lives in the service.
//
// Service-thrown AppError codes map to status centrally via errorMiddleware
// (NOT_FOUND → 404, FORBIDDEN → 403, VALIDATION_FAILED → 400), so routes only
// shape success responses.
export const commentsRouter = Router();

// SLYK-13: edit a comment's body. Author-only authorization is enforced in
// updateComment (FORBIDDEN for non-authors). Empty / oversized bodies fail edge
// validation with VALIDATION_FAILED (400) before the service is reached.
commentsRouter.patch(
  '/:commentId',
  authenticate,
  validateRequest({ params: commentIdParam, body: updateCommentBody }),
  resolveCommentProject(),
  async (req, res) => {
    const { commentId } = req.params as CommentIdParam;
    const body = req.body as UpdateCommentBody;
    const updated = await commentService.updateComment(commentId, req.user!.id, body.body);
    res.json(success(updated));
  },
);

// SLYK-13: delete a comment. Author OR Platform Admin OR Project Admin. The
// admin tier is read off the JWT (`isPlatformAdmin`) and the resolved project
// membership (`projectMember === 'PROJECT_ADMIN'`); the author/admin decision
// itself lives in deleteComment. 204 No Content on success.
commentsRouter.delete(
  '/:commentId',
  authenticate,
  validateRequest({ params: commentIdParam }),
  resolveCommentProject(),
  async (req, res) => {
    const { commentId } = req.params as CommentIdParam;
    await commentService.deleteComment(
      commentId,
      req.user!.id,
      req.user!.isPlatformAdmin,
      req.projectMember === 'PROJECT_ADMIN',
    );
    res.status(204).end();
  },
);

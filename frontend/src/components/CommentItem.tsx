import type { CommentDto } from '@/types/comment';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatDate } from '@/utils/formatDate';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';

// SLYK-13 T12: a single comment row in a ticket's comment thread.
//
// Authorship / admin gate (mirrors the backend commentService authorization
// matrix): Edit is AUTHOR-ONLY; Delete is AUTHOR OR Platform Admin OR Project
// Admin. The current user comes from the auth store; project-admin membership is
// derived from the project member roster via useCurrentProjectMembership(slug).
//
// Null-author handling: a comment whose author row was deleted resolves server-
// side to the all-null sentinel ({ id: '', fullName: null, avatarUrl: null }).
// We render "Unknown user" for it, and — since its author.id ('') can never equal
// the acting user's id — it is never editable by anyone, but admins can still
// delete it. (See backend commentService UNKNOWN_AUTHOR.)

interface CommentItemProps {
    comment: CommentDto;
    /** Project slug — used to derive Project-Admin membership for the delete gate. */
    slug: string;
    onEdit: (comment: CommentDto) => void;
    onDelete: (comment: CommentDto) => void;
}

export function CommentItem({ comment, slug, onEdit, onDelete }: CommentItemProps) {
    const currentUserId = useAuthStore((s) => s.user?.id);
    const isPlatformAdmin = useAuthStore((s) => s.user?.isPlatformAdmin ?? false);
    const { isProjectAdmin } = useCurrentProjectMembership(slug);

    // The deleted-author sentinel has id === '' (and fullName === null), so it
    // can never match a real acting user — canEdit is naturally false for it.
    const isAuthor = Boolean(currentUserId) && currentUserId === comment.author.id;
    const canEdit = isAuthor;
    const canDelete = isAuthor || isPlatformAdmin || isProjectAdmin;

    const name = comment.author.fullName ?? 'Unknown user';
    const absolute = formatDate(comment.createdAt);

    return (
        <li className="flex gap-3 py-3">
            {comment.author.avatarUrl ? (
                <img
                    src={comment.author.avatarUrl}
                    alt={name}
                    className="h-8 w-8 shrink-0 rounded-full"
                />
            ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {name.charAt(0)}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-foreground">{name}</span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <time
                                className="text-xs text-muted-foreground"
                                dateTime={comment.createdAt}
                            >
                                {formatRelativeTime(comment.createdAt)}
                            </time>
                        </TooltipTrigger>
                        <TooltipContent>{absolute}</TooltipContent>
                    </Tooltip>
                    {comment.edited && (
                        <span className="text-xs italic text-muted-foreground">(edited)</span>
                    )}
                    {(canEdit || canDelete) && (
                        <span className="ml-auto flex gap-2">
                            {canEdit && (
                                <button
                                    type="button"
                                    onClick={() => onEdit(comment)}
                                    className="text-xs text-primary hover:underline"
                                >
                                    Edit
                                </button>
                            )}
                            {canDelete && (
                                <button
                                    type="button"
                                    onClick={() => onDelete(comment)}
                                    className="text-xs text-destructive hover:underline"
                                >
                                    Delete
                                </button>
                            )}
                        </span>
                    )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                    {comment.body}
                </p>
            </div>
        </li>
    );
}

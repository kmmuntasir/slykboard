import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { agentMessages, notificationPreferences, projects, tickets, users } from '../db/schema';
import { sendEmail } from './emailService';

// SLYK-0350 — email the ticket creator when a pipeline job enters
// AGENT_WAITING (the agent asked the PM a question). Called by
// pipelineJobService AFTER its transaction commits, fire-and-forget:
// notifyAgentWaitingEmail never throws and never rejects — email is
// best-effort observability, never part of the state-write contract.
//
// Opt-in gate: NotificationPreferences.notifyOnAgentWaiting for the
// (creator, project) pair. Lazy default — NO row means opted-IN (schema
// default true; rows are created lazily on first interaction, SLYK-0390
// owns the endpoints/UI — this reads the table directly per the ticket).
//
// Reads run on `db` (not the caller's tx) because they happen post-commit;
// a fresh connection also avoids pinning the pooled one across SMTP latency.

/** Everything the email needs, resolved in one place. */
interface WaitingEmailContext {
  creatorId: string;
  projectId: string;
  creatorEmail: string;
  projectSlug: string;
  projectName: string;
  ticketTitle: string;
  ticketNumber: number;
  latestAgentMessage: string | null;
}

/** Load creator + project + ticket + latest AGENT message for one ticket. */
async function loadContext(ticketId: string): Promise<WaitingEmailContext | null> {
  const [row] = await db
    .select({
      creatorId: tickets.creatorId,
      projectId: projects.id,
      creatorEmail: users.email,
      projectSlug: projects.slug,
      projectName: projects.name,
      ticketTitle: tickets.title,
      ticketNumber: tickets.ticketNumber,
    })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(users, eq(users.id, tickets.creatorId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!row) return null;

  const [message] = await db
    .select({ body: agentMessages.body })
    .from(agentMessages)
    .where(and(eq(agentMessages.ticketId, ticketId), eq(agentMessages.authorRole, 'AGENT')))
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);

  return {
    ...row,
    latestAgentMessage: message?.body ?? null,
  };
}

/**
 * Opt-in check for the (creator, project) pair. Absent row = opted in
 * (lazy-default true, 04-schema.md NotificationPreferences). Only the
 * creator is gated — nobody else is emailed, so nobody else's preference
 * matters here.
 */
async function isOptedIn(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ notifyOnAgentWaiting: notificationPreferences.notifyOnAgentWaiting })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.projectId, projectId),
      ),
    )
    .limit(1);
  return row?.notifyOnAgentWaiting ?? true;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** F30 D1: URL ref is the unpadded '<SLUG>-<NUMBER>' (e.g. 'SLYK-4'). */
function displayId(ctx: WaitingEmailContext): string {
  return `${ctx.projectSlug.toUpperCase()}-${ctx.ticketNumber}`;
}

function ticketUrl(ctx: WaitingEmailContext): string {
  return `${env.frontendUrl}/projects/${ctx.projectSlug}/tickets/${displayId(ctx)}`;
}

function subject(ctx: WaitingEmailContext): string {
  return `[${displayId(ctx)}] ${ctx.ticketTitle} — agent needs your input`;
}

function plainBody(ctx: WaitingEmailContext): string {
  const lines = [
    `The agent working on ${displayId(ctx)} ("${ctx.ticketTitle}") in project ${ctx.projectName} has a question for you.`,
    '',
  ];
  if (ctx.latestAgentMessage) {
    lines.push(ctx.latestAgentMessage, '');
  }
  lines.push(`Reply here: ${ticketUrl(ctx)}`);
  return lines.join('\n');
}

/** Minimal HTML — single <p> per block, no styling, escaped interpolations. */
function htmlBody(ctx: WaitingEmailContext): string {
  const parts = [
    `<p>The agent working on <strong>${escapeHtml(displayId(ctx))}</strong> ("${escapeHtml(
      ctx.ticketTitle,
    )}") in project ${escapeHtml(ctx.projectName)} has a question for you.</p>`,
  ];
  if (ctx.latestAgentMessage) {
    parts.push(`<pre>${escapeHtml(ctx.latestAgentMessage)}</pre>`);
  }
  parts.push(`<p><a href="${ticketUrl(ctx)}">Reply in Slykboard</a></p>`);
  return parts.join('\n');
}

/**
 * Fire-and-forget AGENT_WAITING email to the ticket creator. Called after
 * the state-transition transaction commits; resolves once delivery is
 * attempted (or failed-and-logged) — and NEVER rejects, so callers can
 * await it without turning email into request-critical work.
 */
export async function notifyAgentWaitingEmail(ticketId: string): Promise<void> {
  try {
    const ctx = await loadContext(ticketId);
    if (!ctx) {
      logger.warn({ ticketId }, 'AGENT_WAITING email skipped — ticket context not found');
      return;
    }
    if (!(await isOptedIn(ctx.creatorId, ctx.projectId))) {
      logger.debug({ ticketId }, 'AGENT_WAITING email suppressed by preference');
      return;
    }
    await sendEmail({
      to: ctx.creatorEmail,
      subject: subject(ctx),
      text: plainBody(ctx),
      html: htmlBody(ctx),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ticketId },
      'AGENT_WAITING email failed',
    );
  }
}

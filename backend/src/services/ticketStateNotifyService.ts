import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { notificationPreferences, projects, tickets, users } from '../db/schema';
import { sendEmail } from './emailService';

// SLYK-0390 — email the ticket creator when a pipeline job enters DONE or
// BLOCKED_HUMAN (06-frontend-ui.md § Notifications — the other two of the
// three email-triggering states; AGENT_WAITING has its own service,
// SLYK-0350). Same contract as notifyAgentWaitingEmail: called by
// pipelineJobService AFTER its transaction commits, fire-and-forget, never
// throws and never rejects — email is best-effort, never part of the
// state-write contract.
//
// Opt-in gates: NotificationPreferences.notifyOnDone / notifyOnBlockedHuman
// for the (creator, project) pair. Lazy default — NO row means opted-IN.
//
// Reads run on `db` (not the caller's tx) because they happen post-commit;
// a fresh connection also avoids pinning the pooled one across SMTP latency.

/** Which preference column gates this trigger. */
export type TicketStateEmailKind = 'done' | 'blockedHuman';

/** Everything the email needs, resolved in one place. */
interface TicketStateEmailContext {
  creatorId: string;
  projectId: string;
  creatorEmail: string;
  projectSlug: string;
  projectName: string;
  ticketTitle: string;
  ticketNumber: number;
}

/** Load creator + project + ticket for one ticket (single three-way join). */
async function loadContext(ticketId: string): Promise<TicketStateEmailContext | null> {
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
  return row ?? null;
}

/**
 * Opt-in check for the (creator, project) pair. Absent row = opted in
 * (lazy-default true, 04-schema.md NotificationPreferences). Only the
 * creator is gated — nobody else is emailed, so nobody else's preference
 * matters here.
 */
async function isOptedIn(
  userId: string,
  projectId: string,
  kind: TicketStateEmailKind,
): Promise<boolean> {
  const [row] = await db
    .select({
      notifyOnDone: notificationPreferences.notifyOnDone,
      notifyOnBlockedHuman: notificationPreferences.notifyOnBlockedHuman,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) return true;
  return kind === 'done' ? row.notifyOnDone : row.notifyOnBlockedHuman;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** F30 D1: URL ref is the unpadded '<SLUG>-<NUMBER>' (e.g. 'SLYK-4'). */
function displayId(ctx: TicketStateEmailContext): string {
  return `${ctx.projectSlug.toUpperCase()}-${ctx.ticketNumber}`;
}

function ticketUrl(ctx: TicketStateEmailContext): string {
  return `${env.frontendUrl}/projects/${ctx.projectSlug}/tickets/${displayId(ctx)}`;
}

/** Plain-English state names per the 06-frontend-ui.md state map. */
function subject(ctx: TicketStateEmailContext, kind: TicketStateEmailKind): string {
  const tail = kind === 'done' ? 'ticket deployed' : 'blocked — needs your help';
  return `[${displayId(ctx)}] ${ctx.ticketTitle} — ${tail}`;
}

function headline(ctx: TicketStateEmailContext, kind: TicketStateEmailKind): string {
  return kind === 'done'
    ? `Ticket ${displayId(ctx)} ("${ctx.ticketTitle}") in project ${ctx.projectName} was deployed.`
    : `Ticket ${displayId(ctx)} ("${ctx.ticketTitle}") in project ${ctx.projectName} is blocked and needs human help.`;
}

function plainBody(ctx: TicketStateEmailContext, kind: TicketStateEmailKind): string {
  const action = kind === 'done' ? 'View it here' : 'Take a look here';
  return `${headline(ctx, kind)}\n\n${action}: ${ticketUrl(ctx)}`;
}

/** Minimal HTML — single <p> per block, no styling, escaped interpolations. */
function htmlBody(ctx: TicketStateEmailContext, kind: TicketStateEmailKind): string {
  const label = kind === 'done' ? 'View in Slykboard' : 'Help in Slykboard';
  return [
    `<p>${escapeHtml(headline(ctx, kind))}</p>`,
    `<p><a href="${ticketUrl(ctx)}">${label}</a></p>`,
  ].join('\n');
}

/**
 * Fire-and-forget DONE / BLOCKED_HUMAN email to the ticket creator. Called
 * after the state-transition transaction commits; resolves once delivery is
 * attempted (or failed-and-logged) — and NEVER rejects, so callers can await
 * it without turning email into request-critical work.
 */
export async function notifyTicketStateEmail(
  ticketId: string,
  kind: TicketStateEmailKind,
): Promise<void> {
  try {
    const ctx = await loadContext(ticketId);
    if (!ctx) {
      logger.warn({ ticketId, kind }, 'ticket-state email skipped — ticket context not found');
      return;
    }
    if (!(await isOptedIn(ctx.creatorId, ctx.projectId, kind))) {
      logger.debug({ ticketId, kind }, 'ticket-state email suppressed by preference');
      return;
    }
    await sendEmail({
      to: ctx.creatorEmail,
      subject: subject(ctx, kind),
      text: plainBody(ctx, kind),
      html: htmlBody(ctx, kind),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ticketId, kind },
      'ticket-state email failed',
    );
  }
}

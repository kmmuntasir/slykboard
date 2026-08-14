import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { agentMessages } from '../db/schema';

// SLYK-0320 — data access for AgentMessages (docs/agentic-automation/
// 04-schema.md § AgentMessages, 05-backend-routes.md § jobs/:ticketId/messages).
// Same shape as pipelineJobRepository: every function takes the caller's tx
// handle so the idempotency check + insert stay atomic (transactions in
// services, per AGENTS.md).

// Local alias mirroring pipelineJobRepository.ts — the drizzle tx client type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type AgentMessageInsert = typeof agentMessages.$inferInsert;

/**
 * Find a message by idempotencyKey (dispatcher retry dedup). Partial unique
 * index idx_agent_messages_idempotency backs the lookup; NULL keys (PM +
 * SYSTEM) never match — isNotNull guard keeps the query planner on the index.
 */
export async function findByIdempotencyKey(
  tx: Tx,
  idempotencyKey: string,
): Promise<AgentMessageRow | null> {
  const [row] = await tx
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

/** Insert one chat message. Caller owns transactionality (service tx). */
export async function insertMessage(tx: Tx, values: AgentMessageInsert): Promise<AgentMessageRow> {
  const [row] = await tx.insert(agentMessages).values(values).returning();
  return row!;
}

/** All messages for a ticket, asc by createdAt (chat render order). */
export async function listByTicketId(tx: Tx, ticketId: string): Promise<AgentMessageRow[]> {
  return tx
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.ticketId, ticketId))
    .orderBy(asc(agentMessages.createdAt));
}

/**
 * Stamp readAt = now() on the ticket's unread AGENT messages — the PM fetch of
 * the thread is the "saw them" event (SLYK-0330 GET behavior step 3). PM and
 * SYSTEM rows are left untouched; a second GET is a no-op (isNull guard).
 * Returns the number of rows stamped.
 */
export async function markAgentMessagesRead(tx: Tx, ticketId: string): Promise<number> {
  const rows = await tx
    .update(agentMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(agentMessages.ticketId, ticketId),
        eq(agentMessages.authorRole, 'AGENT'),
        isNull(agentMessages.readAt),
      ),
    )
    .returning({ id: agentMessages.id });
  return rows.length;
}

/**
 * The ticket's most recent AGENT message's agentSessionId, or null — PM replies
 * route to the session that asked the question (SLYK-0330 POST step 5: the
 * pm_reply payload's agentSessionId comes from the latest AGENT message).
 */
export async function findLatestAgentSessionId(tx: Tx, ticketId: string): Promise<string | null> {
  const [row] = await tx
    .select({ agentSessionId: agentMessages.agentSessionId })
    .from(agentMessages)
    .where(and(eq(agentMessages.ticketId, ticketId), eq(agentMessages.authorRole, 'AGENT')))
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);
  return row?.agentSessionId ?? null;
}

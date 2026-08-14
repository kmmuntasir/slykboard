import { asc, eq } from 'drizzle-orm';
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

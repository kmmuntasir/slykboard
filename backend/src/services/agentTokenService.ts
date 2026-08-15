import { createHash, randomBytes } from 'node:crypto';
import { asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { agentTokens } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { AgentTokenBody } from '../routes/admin-agent.schema';

// SLYK-0370 — UI-managed dispatcher HMAC tokens (rotation path 2 from
// 11-existing-patterns.md § Dispatcher handshake; 05-backend-routes.md §
// POST /api/v1/admin/agent-tokens). Tokens are 64-hex (randomBytes(32));
// only sha256(raw) is persisted — the raw value is returned ONCE by the
// generate route and never retrievable again. Names are NOT unique per
// schema (04-schema.md AgentTokens) — duplicate names are allowed and
// disambiguated by id; documented behavior, not an error.

export type AgentTokenRow = typeof agentTokens.$inferSelect;

/** List projection — every field the /admin/tokens page renders, no hash. */
export type AgentTokenSummary = Pick<
  AgentTokenRow,
  'id' | 'name' | 'projectId' | 'createdBy' | 'revokedAt' | 'createdAt'
>;

/** Token material length — 32 bytes → 64 hex chars (doc behavior step 1). */
const TOKEN_BYTES = 32;

/** sha256 of the raw token, hex — the ONLY form ever persisted. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// POST /api/v1/admin/agent-tokens — generate, persist the hash, return the
// raw token once ({token, id, name}). The insert projects to id + name so
// the full row (with tokenHash) never reaches a caller.
export async function createAgentToken(args: {
  body: AgentTokenBody;
  createdBy: string;
}): Promise<{ token: string; id: string; name: string }> {
  const raw = randomBytes(TOKEN_BYTES).toString('hex');
  const [row] = await db
    .insert(agentTokens)
    .values({
      tokenHash: hashToken(raw),
      name: args.body.name,
      projectId: args.body.projectId,
      createdBy: args.createdBy,
    })
    .returning({ id: agentTokens.id, name: agentTokens.name });

  // Practically unreachable (single-row insert with returning); the row is
  // the contract, not the throw.
  if (!row) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to create agent token');
  }

  return { token: raw, id: row.id, name: row.name };
}

// GET /api/v1/admin/agent-tokens — every row (revoked included; the UI
// renders revoke state). Hashes are never selected, so they cannot leak
// into a response even by accident downstream.
export async function listAgentTokens(): Promise<AgentTokenSummary[]> {
  return db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      projectId: agentTokens.projectId,
      createdBy: agentTokens.createdBy,
      revokedAt: agentTokens.revokedAt,
      createdAt: agentTokens.createdAt,
    })
    .from(agentTokens)
    .orderBy(asc(agentTokens.createdAt));
}

// DELETE /api/v1/admin/agent-tokens/:id — flip revokedAt. 404 unknown id,
// 409 already revoked: a double-revoke retry is NOT silently ok'd — the
// admin should learn the token was already gone.
export async function revokeAgentToken(id: string): Promise<void> {
  const [row] = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(eq(agentTokens.id, id))
    .returning({ id: agentTokens.id, revokedAt: agentTokens.revokedAt });

  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, `Agent token '${id}' not found`, {
      details: { id },
    });
  }
  if (row.revokedAt !== null) {
    throw new AppError(ErrorCode.CONFLICT, 'Agent token is already revoked', {
      details: { id, revokedAt: row.revokedAt },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound candidate set for agentTokenAuth (SLYK-0370 dual-source verify).
// 11-existing-patterns.md § Dispatcher handshake: "DB tokens checked first,
// env token is fallback." Only sha256(raw) is stored, so the middleware
// cannot recompute an HMAC for a DB token on its own — the dispatcher
// presents its raw token (X-Dispatcher-Token) alongside the signature; the
// middleware hashes the presented value against these rows and only then
// uses the presented raw as the HMAC key candidate. The SIGNATURE still
// proves possession of the secret; the row lookup only picks the candidate.
// Revoked rows are excluded here, which is what makes revocation immediate.
// Queried per request — volume is low; the cache seam is deliberate.
// ─────────────────────────────────────────────────────────────────────────

export async function listActiveTokenHashes(): Promise<string[]> {
  const rows = await db
    .select({ tokenHash: agentTokens.tokenHash })
    .from(agentTokens)
    .where(isNull(agentTokens.revokedAt));
  return rows.map((r) => r.tokenHash);
}

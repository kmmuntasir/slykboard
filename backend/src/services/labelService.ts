import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../db/client';
import { labels, projects, ticketLabels, tickets } from '../db/schema';
import type * as schema from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// D7: the common base type that BOTH the shared `db` pool
// (NodePgDatabase<schema> & { $client: Pool }) and a db.transaction callback
// param (PgTransaction, which extends NodePgDatabase) satisfy. The narrow alias
// `Parameters<typeof db.transaction>[0]>[0]` resolves to PgTransaction, which
// `db` is NOT assignable to — so it cannot type a param defaulting to `db`.
// NodePgDatabase exposes every query method (select/insert/update/delete) these
// functions use; the transaction-only members (rollback/savepoint) are unused.
type Tx = NodePgDatabase<typeof schema>;

export type LabelRow = typeof labels.$inferSelect;
export type HydratedLabel = { id: string; name: string; color: string };

export async function listLabels(projectSlug: string): Promise<HydratedLabel[]> {
  const rows = await db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .innerJoin(projects, eq(labels.projectId, projects.id))
    .where(eq(projects.slug, projectSlug))
    .orderBy(labels.name);
  return rows;
}

export async function createLabel(args: {
  projectSlug: string;
  name: string;
  color: string;
}): Promise<LabelRow> {
  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, args.projectSlug))
    .limit(1);
  if (!project[0]) throw new AppError(ErrorCode.NOT_FOUND, 'Project not found');
  try {
    const inserted = await db
      .insert(labels)
      .values({
        projectId: project[0].id,
        name: args.name,
        color: args.color,
      })
      .returning();
    if (!inserted[0]) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Insert returned no row');
    return inserted[0];
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, 'Label name already exists in this project');
    }
    throw err;
  }
}

export async function updateLabel(args: {
  labelId: string;
  patch: { name?: string; color?: string };
}): Promise<{ old: LabelRow; new: LabelRow }> {
  const oldRows = await db.select().from(labels).where(eq(labels.id, args.labelId)).limit(1);
  if (!oldRows[0]) throw new AppError(ErrorCode.NOT_FOUND, 'Label not found');
  const set: Partial<LabelRow> = { updatedAt: new Date() };
  if (args.patch.name !== undefined) set.name = args.patch.name;
  if (args.patch.color !== undefined) set.color = args.patch.color;
  try {
    const updated = await db
      .update(labels)
      .set(set)
      .where(eq(labels.id, args.labelId))
      .returning();
    if (!updated[0]) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Update returned no row');
    return { old: oldRows[0], new: updated[0] };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.CONFLICT, 'Label name already exists in this project');
    }
    throw err;
  }
}

export async function deleteLabel(labelId: string): Promise<{ id: string }> {
  // Cascade on TicketLabels is DB-level (FK ON DELETE CASCADE) — not enforced here.
  const deleted = await db
    .delete(labels)
    .where(eq(labels.id, labelId))
    .returning({ id: labels.id });
  if (!deleted[0]) throw new AppError(ErrorCode.NOT_FOUND, 'Label not found');
  return deleted[0];
}

export async function hydrateLabelsForTickets(
  ticketIds: string[],
  tx: Tx = db,
): Promise<Map<string, HydratedLabel[]>> {
  const map = new Map<string, HydratedLabel[]>();
  if (ticketIds.length === 0) return map;
  const rows = await tx
    .select({
      ticketId: ticketLabels.ticketId,
      labelId: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(ticketLabels)
    .innerJoin(labels, eq(ticketLabels.labelId, labels.id))
    .where(inArray(ticketLabels.ticketId, ticketIds));
  for (const r of rows) {
    const arr = map.get(r.ticketId) ?? [];
    arr.push({ id: r.labelId, name: r.name, color: r.color });
    map.set(r.ticketId, arr);
  }
  return map;
}

export async function replaceTicketLabels(args: {
  ticketId: string;
  labelIds: string[];
}, tx: Tx = db): Promise<void> {
  const ticket = await tx.select().from(tickets).where(eq(tickets.id, args.ticketId)).limit(1);
  if (!ticket[0]) throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found');

  if (args.labelIds.length > 0) {
    const found = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, ticket[0].projectId), inArray(labels.id, args.labelIds)));
    if (found.length !== args.labelIds.length) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'One or more labels do not belong to this project',
      );
    }
  }

  await tx.delete(ticketLabels).where(eq(ticketLabels.ticketId, args.ticketId));
  if (args.labelIds.length > 0) {
    await tx.insert(ticketLabels).values(
      args.labelIds.map((labelId) => ({ ticketId: args.ticketId, labelId })),
    );
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db/client';
import {
  projectSequences,
  projects,
  tickets,
  START_TICKET_NUMBER,
  type Column,
} from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { isReservedSlug, isValidSlug, normalizeSlug } from '../utils/slug';

export type ProjectRow = typeof projects.$inferSelect;

// F08 D-Default-Columns: applied when caller omits columns. REQ-2.2.
const DEFAULT_COLUMNS: ReadonlyArray<Pick<Column, 'name'>> = [
  { name: 'To Do' },
  { name: 'In Progress' },
  { name: 'Done' },
];

function withIds(columns: ReadonlyArray<Pick<Column, 'name'>>): Column[] {
  return columns.map((column) => ({ id: randomUUID(), name: column.name }));
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  columns?: Column[];
  creatorId: string;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  // F08 D-Slug-Format: normalize then validate.
  const slug = normalizeSlug(input.slug);
  if (!isValidSlug(slug)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Invalid slug format: '${slug}'`, {
      details: { slug },
    });
  }
  // F08 D-Reserved-Slugs.
  if (isReservedSlug(slug)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Slug '${slug}' is reserved`, {
      details: { slug },
    });
  }

  // F08 D-Slug-Uniqueness: pre-check (DB unique is the authoritative backstop).
  const existing = await getProjectBySlug(slug);
  if (existing) {
    throw new AppError(ErrorCode.CONFLICT, `Project slug '${slug}' already exists`, {
      details: { slug },
    });
  }

  // F08 D-Default-Columns + D-Column-Identity: ensure every column has an id.
  const columns: Column[] =
    input.columns && input.columns.length > 0
      ? input.columns.map((column) => ({ id: column.id ?? randomUUID(), name: column.name }))
      : withIds(DEFAULT_COLUMNS);

  // F12 D1: insert the project AND seed its ticket_number counter in one
  // transaction so allocateTicketNumber never observes a missing
  // project_sequences row. A fresh project has no tickets, so the counter
  // starts at START_TICKET_NUMBER (= 1, SLYK-001).
  const row = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name: input.name,
        slug,
        columns,
        creatorId: input.creatorId,
      })
      .returning();

    // F12: seed the per-project counter so allocateTicketNumber never sees a missing row.
    await tx.insert(projectSequences).values({
      projectId: project!.id,
      nextNumber: START_TICKET_NUMBER,
    });

    return project!;
  });
  return row;
}

export async function listProjects(): Promise<ProjectRow[]> {
  return db.select().from(projects).orderBy(projects.createdAt);
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row ?? null;
}

// F27 T1: rename a project and/or replace its columns JSONB. Slug is NOT editable.
// Blocking rule: a column still holding live (non-deleted) tickets cannot be removed.
export async function updateProject(args: {
  slug: string;
  name?: string;
  columns?: Column[];
}): Promise<ProjectRow> {
  const project = await getProjectBySlug(args.slug);
  if (!project) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project '${args.slug}' not found`);
  }

  const updateSet: Partial<ProjectRow> = { updatedAt: new Date() };
  if (args.name !== undefined) {
    updateSet.name = args.name;
  }
  if (args.columns !== undefined) {
    if (args.columns.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, 'A project must have at least one column');
    }
    for (const col of args.columns) {
      if (!col.id || !col.name || col.name.trim() === '') {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'Each column must have an id and non-empty name',
        );
      }
    }
    // F27: block deleting a column that still has live (non-deleted) tickets.
    const oldIds = new Set(project.columns.map((c) => c.id));
    const newIds = new Set(args.columns.map((c) => c.id));
    const removed = [...oldIds].filter((id) => !newIds.has(id));
    for (const colId of removed) {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tickets)
        .where(
          and(
            eq(tickets.projectId, project.id),
            eq(tickets.statusColumn, colId),
            isNull(tickets.deletedAt),
          ),
        );
      if (row && Number(row.count) > 0) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Cannot delete column: ${row.count} ticket(s) still in this column. Move them first.`,
        );
      }
    }
    updateSet.columns = args.columns;
  }

  const [updated] = await db
    .update(projects)
    .set(updateSet)
    .where(eq(projects.slug, args.slug))
    .returning();
  // Project existence was verified above; the UPDATE targets that same row.
  return updated!;
}

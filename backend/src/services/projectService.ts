import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db/client';
import {
  projectMembers,
  projectSequences,
  projects,
  tickets,
  START_TICKET_NUMBER,
  type Column,
} from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { isReservedSlug, isValidSlug, normalizeSlug } from '../utils/slug';
import { isProjectMember } from './membershipService';

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

// SLYK-01 Task J — visibility is membership-scoped with a Platform-Admin bypass.
// A Member sees only projects where they have a project_members row; a Platform
// Admin sees every project. Ordering by createdAt preserves the prior default.
export async function listProjects(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<ProjectRow[]> {
  if (isPlatformAdmin) {
    return db.select().from(projects).orderBy(projects.createdAt);
  }
  // Members always see their projects regardless of projects.isActive —
  // deactivation behavior is owned by DEL-04; here we only scope.
  return db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      columns: projects.columns,
      creatorId: projects.creatorId,
      isActive: projects.isActive,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, userId))
    .orderBy(projects.createdAt);
}

// SLYK-01 Task J — non-revealing single-project lookup.
//
// - No-user overload (userId undefined): returns the row or null WITHOUT
//   throwing. Used by createProject's slug-uniqueness probe — a free slug must
//   surface as null, not as an exception.
// - User-scoped overload (userId provided): unknown slug and inaccessible slug
//   are indistinguishable — both throw the identical non-revealing FORBIDDEN
//   ('You do not have access to this project'). Platform Admins bypass the
//   membership check; everyone else is gated through membershipService.
export async function getProjectBySlug(
  slug: string,
  userId?: string,
  isPlatformAdmin?: boolean,
): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

  // Uniqueness-probe path: no caller identity → return existence, never throw.
  if (userId === undefined) {
    return row ?? null;
  }

  // User-scoped path: not-found is non-revealing (same FORBIDDEN as non-member).
  if (!row) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
  }

  // Platform Admin bypass — global visibility, no membership row required.
  if (isPlatformAdmin === true) {
    return row;
  }

  // Membership probe inside the caller's read scope via the shared tx idiom
  // (membershipService owns ALL project_members access — no direct reads here).
  const allowed = await db.transaction((tx) => isProjectMember(tx, row.id, userId));
  if (!allowed) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
  }
  return row;
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
    const columnIds = args.columns.map((c) => c.id);
    if (new Set(columnIds).size !== columnIds.length) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Column ids must be unique');
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

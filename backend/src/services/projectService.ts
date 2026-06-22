import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { projects, type Column } from '../db/schema';
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

  const [row] = await db
    .insert(projects)
    .values({
      name: input.name,
      slug,
      columns,
      creatorId: input.creatorId,
    })
    .returning();
  return row!;
}

export async function listProjects(): Promise<ProjectRow[]> {
  return db.select().from(projects).orderBy(projects.createdAt);
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row ?? null;
}

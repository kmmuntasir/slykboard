import { db } from './client';
import { tickets, projects, users, type Column } from './schema';
import { eq } from 'drizzle-orm';

// F09: read-render seed. F12 owns creation; this gives the board endpoint data.
// Idempotent: wipes seeded rows then re-inserts. Run via `npm run db:seed -w backend`.
const SEED_PROJECT_SLUG = 'SLYK';
const SEED_USER_EMAIL = 'seed@slykboard.local';
const ORPHAN_COLUMN_ID = 'orphan-column-id-not-in-project'; // D-Unsorted-Bucket proof

// Local OAuth-bypass dev fixtures (idempotent — no overwrite, no dupes).
const DEV_USERS = [
  {
    googleId: 'admin-dev-fixture',
    email: 'admin@slykboard.local',
    fullName: 'Dev Admin',
    role: 'ADMIN' as const,
  },
  {
    googleId: 'member-dev-fixture',
    email: 'member@slykboard.local',
    fullName: 'Dev Member',
    role: 'MEMBER' as const,
  },
];

export async function seedBoard(): Promise<void> {
  // 1. Ensure dev login fixtures exist (local OAuth-bypass).
  //    F06's `users_one_admin` partial unique index allows exactly one ADMIN.
  //    Seed the admin fixture only when no ADMIN exists yet, so re-running on a DB
  //    that already holds a real/admin user never violates the constraint. Member
  //    fixture always upserts.
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);

  await db
    .insert(users)
    .values(existingAdmin ? DEV_USERS.filter((u) => u.role !== 'ADMIN') : DEV_USERS)
    .onConflictDoNothing({ target: users.email });

  // 2. Ensure seed user exists (assignee + creator).
  const [user] = await db
    .insert(users)
    .values({
      googleId: SEED_USER_EMAIL,
      email: SEED_USER_EMAIL,
      fullName: 'Seed User',
      role: 'MEMBER',
    })
    .onConflictDoUpdate({ target: users.email, set: { fullName: 'Seed User' } })
    .returning();

  // 3. Ensure seed project exists with default columns (D-Default-Columns from F08).
  const [project] = await db
    .insert(projects)
    .values({
      name: 'Slyk',
      slug: SEED_PROJECT_SLUG,
      columns: [
        { id: 'col-todo', name: 'To Do' },
        { id: 'col-doing', name: 'In Progress' },
        { id: 'col-done', name: 'Done' },
      ] satisfies Column[],
      creatorId: user!.id,
    })
    .onConflictDoUpdate({ target: projects.slug, set: { name: 'Slyk' } })
    .returning();

  // 4. Wipe + re-insert tickets for this project (idempotent).
  await db.delete(tickets).where(eq(tickets.projectId, project!.id));

  const now = new Date();
  await db.insert(tickets).values([
    {
      projectId: project!.id,
      ticketNumber: 101,
      title: 'Render board columns',
      statusColumn: 'col-todo',
      position: 10,
      assigneeId: user!.id,
      creatorId: user!.id,
      priority: 'HIGH',
      labels: ['frontend'],
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId: project!.id,
      ticketNumber: 102,
      title: 'Group tickets by column',
      statusColumn: 'col-doing',
      position: 20,
      assigneeId: null,
      creatorId: user!.id,
      priority: 'MEDIUM',
      labels: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId: project!.id,
      ticketNumber: 103,
      title: 'Orphan ticket (deleted column)',
      statusColumn: ORPHAN_COLUMN_ID, // matches no project column → Unsorted
      position: 30,
      assigneeId: user!.id,
      creatorId: user!.id,
      priority: 'LOW',
      labels: ['edge-case'],
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

seedBoard()
  .then(() => {
    console.log('F09 board seed applied');
    process.exit(0);
  })
  .catch((err) => {
    console.error('F09 board seed failed', err);
    process.exit(1);
  });

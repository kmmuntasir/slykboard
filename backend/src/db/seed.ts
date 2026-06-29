import { db } from './client';
import {
  tickets,
  projects,
  projectSequences,
  users,
  projectMembers,
  labels,
  ticketLabels,
  START_TICKET_NUMBER,
  type Column,
} from './schema';
import { eq } from 'drizzle-orm';

// F09: read-render seed. F12 owns creation; this gives the board endpoint data.
// Idempotent: wipes seeded rows then re-inserts. Run via `npm run db:seed -w backend`.
//
// SLYK-01 §Resolved Decisions: the seed contains EXACTLY ONE user — a Platform
// Admin — and nobody else. There is no global role enum anymore; platform-admin is
// a boolean (users.is_platform_admin) and project-scoped roles live in
// project_members. We seed one project_members row making the PA a PROJECT_ADMIN
// of the seeded project so the membership model has data and the member-management
// UI has a row to show. Member provisioning is now bootstrap + Member Management
// (Tasks E/L), never the seed.
const SEED_PROJECT_SLUG = 'SLYK';
const SEED_USER_EMAIL = 'seed@slykboard.local';
const ORPHAN_COLUMN_ID = 'orphan-column-id-not-in-project'; // D-Unsorted-Bucket proof
// F12: number of seeded tickets, numbered START_TICKET_NUMBER..START_TICKET_NUMBER+this-1
// (1..3). project_sequences.nextNumber must point PAST them so the next
// allocateTicketNumber returns the first unused number — mirrors the 0005 backfill
// COALESCE(MAX(ticket_number),0)+1. Bump this if the seed gains a ticket.
const SEED_TICKET_COUNT = 3;

export async function seedBoard(): Promise<void> {
  // 1. Ensure exactly one Platform Admin exists (the seed's sole user).
  //    onConflictDoUpdate on email keeps this idempotent across re-runs and pins
  //    isPlatformAdmin=true so the seed remains the canonical PA fixture.
  const [user] = await db
    .insert(users)
    .values({
      googleId: SEED_USER_EMAIL,
      email: SEED_USER_EMAIL,
      fullName: 'Seed Admin',
      displayName: 'Seed Admin',
      isPlatformAdmin: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { fullName: 'Seed Admin', displayName: 'Seed Admin', isPlatformAdmin: true },
    })
    .returning();

  // 2. Ensure seed project exists with default columns (D-Default-Columns from F08).
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

  // 3. SLYK-01: seed exactly one project_members row — the PA as PROJECT_ADMIN of
  //    the seed project. Composite PK makes this idempotent on re-run; the set
  //    clause pins the role so re-seeding never downgrades it.
  await db
    .insert(projectMembers)
    .values({ projectId: project!.id, userId: user!.id, role: 'PROJECT_ADMIN' })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role: 'PROJECT_ADMIN' },
    });

  // 4. Wipe + re-insert tickets for this project (idempotent).
  await db.delete(tickets).where(eq(tickets.projectId, project!.id));

  const now = new Date();
  const inserted = await db
    .insert(tickets)
    .values([
      {
        projectId: project!.id,
        ticketNumber: 1,
        title: 'Render board columns',
        statusColumn: 'col-todo',
        position: 10,
        assigneeId: user!.id,
        creatorId: user!.id,
        priority: 'HIGH',
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project!.id,
        ticketNumber: 2,
        title: 'Group tickets by column',
        statusColumn: 'col-doing',
        position: 20,
        assigneeId: null,
        creatorId: user!.id,
        priority: 'MEDIUM',
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project!.id,
        ticketNumber: 3,
        title: 'Orphan ticket (deleted column)',
        statusColumn: ORPHAN_COLUMN_ID, // matches no project column → Unsorted
        position: 30,
        assigneeId: user!.id,
        creatorId: user!.id,
        priority: 'LOW',
        createdAt: now,
        updatedAt: now,
      },
    ])
    .returning();

  // F14: seed a color-coded label catalog + link some to tickets so the board
  // renders LabelChips out of the box. Wiping labels by project is idempotent;
  // ticket_labels for old tickets already cascaded on the ticket delete above.
  await db.delete(labels).where(eq(labels.projectId, project!.id));
  const labelRows = await db
    .insert(labels)
    .values([
      { projectId: project!.id, name: 'Bug', color: '#EF4444' },
      { projectId: project!.id, name: 'Feature', color: '#10B981' },
      { projectId: project!.id, name: 'Urgent', color: '#F59E0B' },
      { projectId: project!.id, name: 'Frontend', color: '#3B82F6' },
      { projectId: project!.id, name: 'Backend', color: '#8B5CF6' },
    ])
    .returning();
  const labelByName = new Map(labelRows.map((l) => [l.name, l.id]));
  const ticketByNumber = new Map(inserted.map((t) => [t.ticketNumber, t.id]));
  const labelId = (name: string): string => {
    const id = labelByName.get(name);
    if (!id) throw new Error(`seed label missing: ${name}`);
    return id;
  };
  const ticketId = (num: number): string => {
    const id = ticketByNumber.get(num);
    if (!id) throw new Error(`seed ticket missing: ${num}`);
    return id;
  };
  await db.insert(ticketLabels).values([
    { ticketId: ticketId(1), labelId: labelId('Feature') },
    { ticketId: ticketId(1), labelId: labelId('Frontend') },
    { ticketId: ticketId(2), labelId: labelId('Bug') },
    { ticketId: ticketId(2), labelId: labelId('Urgent') },
    { ticketId: ticketId(3), labelId: labelId('Backend') },
  ]);

  // F12: seed the per-project counter AFTER the ticket inserts so it points PAST
  // the seeded tickets (1..3). nextNumber = START_TICKET_NUMBER + SEED_TICKET_COUNT
  // = 4 → the first UNUSED number, so allocateTicketNumber never returns 1..3 and
  // never trips the unique (project_id, ticket_number) backstop (23505). Mirrors
  // the 0005 backfill rule COALESCE(MAX(ticket_number),0)+1. Idempotent via
  // onConflictDoUpdate. (T3's createProject seeds START_TICKET_NUMBER for FRESH
  // projects with no tickets — different, correct case.)
  await db
    .insert(projectSequences)
    .values({ projectId: project!.id, nextNumber: START_TICKET_NUMBER + SEED_TICKET_COUNT })
    .onConflictDoUpdate({
      target: projectSequences.projectId,
      set: { nextNumber: START_TICKET_NUMBER + SEED_TICKET_COUNT },
    });
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

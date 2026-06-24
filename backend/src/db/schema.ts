import { eq } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  unique,
  integer,
  jsonb,
  doublePrecision,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// F12 D2: ticket_number starts at 1 per project (Jira default). Zero-pad
// display to 3 digits (SLYK-001) — formatting is frontend-only (TicketCard).
export const START_TICKET_NUMBER = 1;

// PRD §8.1 — role enum. Admin manages settings; Member is default.
export const roleEnum = pgEnum('Role', ['ADMIN', 'MEMBER']);

// PRD §8.1 — Users table, verbatim columns + standard UTC timestamps.
// snake_case column names via the 2nd arg; camelCase access keys via the 1st arg.
export const users = pgTable(
  'Users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleId: text('google_id').notNull().unique(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: roleEnum('role').default('MEMBER').notNull(),
    // F07 D3: token version for hard session invalidation. authenticate compares
    // the JWT `ver` claim to this column; bumpTokenVersion increments it.
    // Default 0 so existing rows need no data migration.
    tokenVersion: integer('token_version').default(0).notNull(),
    // Convention: every table carries UTC timestamptz (F18 audit + F20+ baseline).
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    // Drizzle has no SQL-layer @updatedAt; bump on every update via this hook.
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    // F06 D1: race-safe first-admin guard. At most one ADMIN row; DB is the hard guarantee.
    usersOneAdminIdx: uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN')),
  }),
);

// F08 D-Column-Identity: column identity is {id, name}, NOT a bare string.
// id = crypto.randomUUID() (stable across renames); name is the display label.
// PRD §8.2 specified a string array; F08 upgrades to {id, name} (schema delta §8).
export interface Column {
  id: string;
  name: string;
}

// F15 D1: checklist sub-items on a ticket. Stored as a JSONB array on Tickets
// (not a join table — items are ticket-scoped, not shared entities like labels).
// id = client-generated UUID (crypto.randomUUID); validated as uuid() at the edge.
// Concurrent edits use last-write-wins full-array replace (D4).
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export const projects = pgTable('Projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // F08 D-Column-Identity: ordered array of {id, name}. JSONB; Drizzle $type for TS shape.
  columns: jsonb('columns').$type<Column[]>().notNull(),
  // F08 D-Creator-FK: PRD omits; aligns with §8.3 Tickets creator FK.
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  // F08 D-Timestamps: PRD omits; aligns with Users schema.
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// F12 D1: per-project ticket_number counter. allocateTicketNumber() does
// SELECT ... FOR UPDATE on this row inside db.transaction; the unique
// (project_id, ticket_number) index on tickets is the defense-in-depth backstop.
// nextNumber defaults to START_TICKET_NUMBER (1) so a freshly-created project
// starts numbering at SLYK-001.
export const projectSequences = pgTable('project_sequences', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id),
  nextNumber: integer('next_number').notNull().default(START_TICKET_NUMBER),
});

// F09 D-Priority-Enum: SCREAMING_SNAKE per style guide. PRD REQ-3.2 Title-Case is UI-only.
export const priorityEnum = pgEnum('Priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']);

// F09 D-Tickets-Table: PRD §8.3 read-render slice. F12 owns creation.
// statusColumn is text (references a Column.id in Projects.columns JSONB) —
// no Columns table exists, so integrity is enforced at read time (D-Unsorted-Bucket).
// position is doublePrecision: F09 read-sorts ASC; F11 will write-reorder.
export const tickets = pgTable(
  'Tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    ticketNumber: integer('ticket_number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    statusColumn: text('status_column').notNull(),
    position: doublePrecision('position').notNull().default(0),
    assigneeId: uuid('assignee_id').references(() => users.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    priority: priorityEnum('priority').default('MEDIUM').notNull(),
    // F15 D1: checklist JSONB array of {id, text, done}. Defaults to [] so a new
    // ticket starts empty (createTicket needs no checklist arg). Copy the
    // projects.columns jsonb $type idiom (schema.ts:66).
    checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // F17 D1: soft-delete tombstone. NULL = live; set to now() by deleteTicket.
    // Nullable, no default (null = live). UTC timestamptz per project rule.
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    // F12 D1: invariant backstop — two concurrent creates can never share a number.
    // Primary mechanism is FOR UPDATE on project_sequences; this constraint catches
    // any allocator bug as PG 23505 → mapped to CONFLICT.
    ticketsProjectNumberUq: unique('tickets_project_number_uq').on(
      table.projectId,
      table.ticketNumber,
    ),
  }),
);

// F14 D-Labels-Catalog: project-scoped label definitions. color normalized #RRGGBB uppercase.
// Unique (project_id, name) enforced via labels_project_name_uniq.
export const labels = pgTable(
  'Labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectLabelNameUniq: uniqueIndex('labels_project_name_uniq').on(table.projectId, table.name),
  }),
);

// F14 D-TicketLabels: many-to-many join. Composite PK prevents dupes.
// Both FKs ON DELETE CASCADE — deleting a ticket or label cleans up automatically.
export const ticketLabels = pgTable(
  'TicketLabels',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ticketId, table.labelId] }),
    labelIdx: index('ticket_labels_label_id_idx').on(table.labelId),
  }),
);

// F18 — Activity log capture (PRD §8.5, REQ-5.2/5.3). Append-only audit trail;
// every row is stamped inside the mutation's own transaction so logs never diverge.
// No updatedAt (append-only); no jsonb metadata — §8.5 mandates String old/new_value.
export const activityActionEnum = pgEnum('ActivityAction', [
  'CREATED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'ASSIGNEE_CHANGED',
  'LABELS_CHANGED', // F18-added per features.md deltas table
  'CONTENT_UPDATED',
]);

// PRD §8.5 — ActivityLogs. user_id nullable + ON DELETE SET NULL preserves audit
// history when an acting user is deleted. ticket_id ON DELETE CASCADE (owned by ticket).
export const activityLogs = pgTable(
  'ActivityLogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actionType: activityActionEnum('action_type').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // F19 feed query: WHERE ticket_id = $1 ORDER BY created_at.
    ticketIdx: index('activity_logs_ticket_id_idx').on(table.ticketId),
  }),
);

import { eq } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

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

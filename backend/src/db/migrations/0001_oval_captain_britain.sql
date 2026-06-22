-- F06 D1: race-safe first-admin guard. At most ONE row may have role='ADMIN'.
-- Hand-reconciled to a literal predicate: drizzle-kit 0.31 parameterizes enum
-- values in partial-index WHERE clauses (emits "= $1"), which fails at migrate
-- time with "there is no parameter $1". The literal form below is the only
-- apply-able expression and matches the §8 expected SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin" ON "Users" USING btree ("role") WHERE "role" = 'ADMIN';

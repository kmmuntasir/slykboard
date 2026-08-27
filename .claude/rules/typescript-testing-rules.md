# TypeScript Testing Rules (Vitest)

## Overview

Vitest for both workspaces. Backend: HTTP-level route tests with `supertest` against the real Express app and the Postgres test DB (`DATABASE_URL` injected by `backend/vitest.config.ts`). Frontend: `@testing-library/react` (jsdom); test config lives inside `vite.config.ts`. Tests are co-located next to sources in both workspaces (`*.test.ts` beside src — there is no separate backend tests/ directory).

## Test Organization

- Backend: co-located beside the code (`projects.routes.test.ts` next to `projects.routes.ts`).
- Frontend: co-located `*.test.ts(x)` next to the source file (`TicketCard.test.tsx`).
- One behavior per test. Names: `should_<behavior>_when_<condition>` or `returnsX_whenY`. Pick one and stay consistent within the file.
- AAA layout: Arrange, Act, Assert. Separate visually with blank lines.
- Deterministic data only — fixed fixtures, no uncontrolled randomness.

## Backend (Vitest + supertest)

- Import `app` from `../index` and run `supertest` against that instance — never boot a live listening server.
- Authenticate by minting a token through `src/utils/jwt` helpers (`signJwt`), signed with the `JWT_SECRET` the vitest env provides; claims match production shape `{ sub, email, pa, ver }`.
- Arrange state directly: insert user/project/membership rows via the drizzle client (or call the service), then act on the route.
- Mock policy: `jose` and Google OAuth are mocked at the boundary (see the `../config` barrel mock pattern used across route suites); everything else exercises the real middleware chain.
- Test happy paths + error paths (400/401/403/404/409). Soft-delete and membership edge cases are the canonical error-path coverage: non-members get `403 FORBIDDEN`, soft-deleted tickets resolve to `404 NOT_FOUND`.

```ts
import request from 'supertest'
import { app } from '../index'
import { signJwt } from '../utils/jwt'
import { db } from '../db/client'
import { users } from '../db/schema'

describe('projects', () => {
  it('lists projects when authenticated', async () => {
    // Arrange
    await db.insert(users).values(fixtureUser)
    const token = await signJwt({ sub: fixtureUser.id, email: fixtureUser.email, pa: false, ver: 0 })

    // Act
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`)

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0) // success envelope: { data }
  })
})
```

Error-shape assertion:

```ts
expect(res.status).toBe(401)
expect(res.body.error.code).toBe('UNAUTHENTICATED')
```

## Frontend (Vitest + Testing Library)

- Render with `@testing-library/react`; user interactions via `@testing-library/user-event`.
- Mock API calls at the module boundary: `vi.mock` the consumed `api/*` domain module (project convention) or stub the query hook. Never hit real network.
- Reset Zustand stores between tests (set initial state explicitly) so tests stay independent.
- Give each render a fresh React Query `QueryClient`.
- Anything touching drag-and-drop renders through `renderInDnd` from `src/test/dndWrapper.tsx`.
- Assert on accessible queries (`getByRole`, `getByText`) — not implementation details.
- Test happy paths + error/loading/empty states.

```tsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { TicketCard } from './TicketCard'

vi.mock('@/api/tickets', () => ({
  fetchTickets: vi.fn().mockResolvedValue([ticketFixture]),
}))

describe('TicketCard', () => {
  it('shows the ticket title', () => {
    render(<TicketCard ticket={ticketFixture} />)
    expect(screen.getByRole('heading', { name: 'Fix login redirect' })).toBeInTheDocument()
  })
})
```

## Assertions

- Use Vitest's `expect` + Jest-DOM matchers (`toBeInTheDocument`, `toBeDisabled`, etc.).
- One logical assertion per test (multiple related assertions on the same subject are fine).
- Assert on outcomes, not implementation calls.
- Asserting the response envelope shape (`{ data }` / `{ error: { code } }`) is encouraged.

## Coverage

- Business logic >80%, components >70%.
- Cover error cases alongside happy paths.

## Running

```bash
npm run test -w backend                                            # backend suite
npm run test -w frontend                                           # frontend suite
npm run test -w backend -- src/utils/jwt.test.ts                   # single backend file
make test                                                          # all workspaces
```

## Parallelism and Speed

- Tests must be independent — no shared mutable state, no test ordering assumptions.
- Keep unit/component tests fast (<1s each).

## Avoid

- `vi.useRealTimers()` surprises — be explicit about fake timers for timer/polling tests (the board polls on an interval, timer displays tick against server time).
- Time-dependent assertions off raw wall-clock values — fixtures are fixed; where "now" matters use relative values or mocked/clock-controlled time, never a bare `Date.now()` comparison.
- Catching and swallowing in tests to "make them pass".
- Commenting out failing tests instead of fixing them.
- `console.log` for debug.

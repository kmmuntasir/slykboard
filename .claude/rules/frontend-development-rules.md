# Frontend Development Rules

## General

React 19 + TypeScript strict + Vite 7 + Tailwind v4 (CSS-first) + Radix-based UI kit. Routing via React Router v7 data routers. Server state via TanStack React Query exclusively. Client state via Zustand (exactly 3 stores). HTTP via the shared custom `apiFetch` client — do NOT add any third-party request/HTTP library to this project. Tests via Vitest + Testing Library (jsdom).

## Project Structure

```
frontend/
    src/
        main.tsx           # Entry: GoogleOAuthProvider + QueryClientProvider + RouterProvider
        App.tsx            # RootLayout shell: CrossTabLogoutSync, sonner <Toaster>, app mounts
        index.css          # Tailwind v4 CSS-first theme (@import 'tailwindcss', @theme, .dark variant)
        test-setup.ts      # Vitest globals setup: env stubs, polyfills, jest-dom matchers
        api/               # client.ts (apiFetch) + typed domain modules + queryKeys.ts
        components/        # feature components, ui/ (Radix primitives), ticket-fields/
        config/            # env.ts — frozen, fail-fast validated VITE_ variables
        constants/         # shared constants
        hooks/             # useAuthSync, useServerTime, ...
        lib/               # queryClient.ts, cn() helper, general utilities
        pages/             # LoginPage, BoardPage, ReportsPage, MembersPage, SettingsPage, AccountPage, ...
        routes/            # index.tsx — single source of truth for the route tree
        stores/            # Zustand: useAuthStore, useProjectStore, useBoardUiStore
        test/              # test helpers: dndWrapper.tsx exports renderInDnd
        types/             # shared TypeScript types
        utils/             # boardReorder.ts, sanitizeHtml.ts, pure helpers
    public/
    index.html
    vite.config.ts         # Vite + @tailwindcss/vite plugin + embedded Vitest config
    tsconfig.json
```

## Component Conventions

- One component per file. PascalCase filenames: `TicketCard.tsx`.
- Functional components + hooks only. No class components.
- Explicit prop interfaces (`TicketCardProps`), no `any`.
- Early returns over nested branches.
- Co-locate `*.test.tsx` next to the component.
- Compose existing `components/ui/` primitives before writing new markup.
- Extract reusable logic into custom hooks.
- Reusability: any element duplicated at ≥90% similarity in two places becomes a component.

## State Management

- **Server state** — TanStack React Query, nothing else. Shared keys live in `api/queryKeys.ts`; default `staleTime` is 30s (`lib/queryClient.ts`); board polling interval comes from `VITE_POLL_INTERVAL_SECONDS`.
- **Client state** — Zustand, exactly 3 stores in `src/stores/`: `useAuthStore` (user + JWT, localStorage-persisted), `useProjectStore` (`lastSelectedSlug`), `useBoardUiStore` (filters/search/drag). Adding a 4th store needs justification first.
- **Local state** — `useState`. Don't reach for a store when local suffices.
- **URL state** — React Router params and search params for shareable state.
- **Form state** — react-hook-form + zodResolver. Do NOT add another form library.

## Styling — Tailwind v4

- Use Tailwind utility classes directly in JSX (`className="..."`). Avoid inline `style={{}}`.
- There is NO JavaScript Tailwind configuration file and none may be reintroduced — the theme lives entirely in `src/index.css` (CSS-first: `@theme` with OKLCH custom properties, dark mode via `.dark` custom variant, wired by the `@tailwindcss/vite` plugin).
- Consume semantic tokens (`--background`, `--primary`, `--destructive`, ...) rather than raw color literals, so light/dark stay consistent.
- Conditional classes go through `cn()` (clsx + tailwind-merge).
- Icons come from `lucide-react`.
- New UI need => extend `components/ui/` on top of Radix primitives. Do NOT pull another component/styling library.

## Routing

- `src/routes/index.tsx` with `createBrowserRouter` is the single source of truth for routes.
- Guards are components: `RequireAuth` (wraps the app layout) and `RequirePlatformAdmin` (`/settings`).
- Top-level paths: `/login` (public), `/` + `/projects` + `/projects/:slug` (board), `/projects/:slug/settings|members|reports` (project scoped), `/reports` (redirects into scope), `/settings` (platform admin), `/account`, `/forbidden`, `*` (`NotFoundPage`). RootLayout hosts `CrossTabLogoutSync`.
- Ticket detail is a **modal overlay route**: `/projects/:slug/tickets/:displayId` renders `TicketDetailModal` over the board and survives refresh/deep links.
- Error boundaries per subtree (`RouteErrorBoundary`) built on `react-error-boundary`; lazy-load heavy routes behind Suspense where applicable.

## Data Fetching / API Client

- All requests flow through `api/client.ts` `apiFetch<T>(path, init)` — NEVER call `fetch` directly from components or hooks.
- Contract: attaches `Authorization: Bearer` from `useAuthStore.getState().user?.token`; unwraps the success envelope and returns `data`; throws `ApiClientError(status, code, details)` on the error envelope; resolves `null` on `204`; skips auth handling for `/auth/*` paths.
- On `401` UNAUTHENTICATED: one coalesced refresh (handlers registered via `registerLogoutHandlers({ refresh, logout })`), retries the request once on success, otherwise logs out once.
- On `403` FORBIDDEN for project-scoped paths: triggers the registered forbidden handler, which redirects to `/projects` (registered by `useAuthSync`).
- Domain logic lives in typed `api/*.ts` modules (`auth`, `boards`, `comments`, `labels`, `members`, `projects`, `reports`, `tickets`, `time`, `timer`, `users`, `queryKeys`) — service functions return typed data.
- Components/hooks consume data through React Query hooks; mutations invalidate the affected keys from `queryKeys`.
- Match the backend envelope exactly (`{ data }` / `{ error: { code, message, details } }`). Shapes are defined by backend route Zod schemas (`*.schema.ts`) — never invent shapes.

```typescript
import { apiFetch } from '@/api/client'
import type { Ticket } from '@/types/ticket'

export async function fetchTickets(projectSlug: string): Promise<Ticket[]> {
  return apiFetch<Ticket[]>(`/projects/${projectSlug}/tickets`)
}
```

## Forms

- react-hook-form + `@hookform/resolvers` zodResolver. Zod schemas mirror backend `*.schema.ts` field rules exactly.
- Version skew: frontend pins zod v3 while the backend uses zod v4 — keep each pinned; don't try to share schema packages.
- Errors surface under `Field` components (`Field`, `TextInput`, `Textarea`, `Select`, ...).
- Destructive actions (delete, deactivate, promote/demote) require a confirmation dialog (`ConfirmDialog` / `ConfirmDiscardDialog`) BEFORE executing — always, both UI and flows.

## Rich Text + Board Specifics

- Rich text is `RichTextEditor` — self-hosted CKEditor 5 (GPL build, no cloud license).
- Image URLs restricted to `http(s)`; editor output also passes `utils/sanitizeHtml.ts` before persisting/rendering.
- Drag-and-drop uses `@hello-pangea/dnd`; reorder position math lives in `utils/boardReorder.ts` (+ `boardInsert` / `boardPatch` helpers). Optimistic updates are fine — the server remains the source of truth for order.
- Timer displays compute elapsed time against the server clock (`useServerTime` server-sync offset), never against the device clock for persisted values.

## Environment Variables

Prefix with `VITE_`; validated at boot in `src/config/env.ts` (frozen object, fail-fast on missing/invalid):

| Variable                    | Required | Notes                                                 |
| --------------------------- | -------- | ----------------------------------------------------- |
| `VITE_API_BASE_URL`         | Yes      | Backend base URL, e.g. `http://localhost:3000/api`     |
| `VITE_GOOGLE_CLIENT_ID`     | Yes      | Google OAuth client id for `@react-oauth/google`       |
| `VITE_POLL_INTERVAL_SECONDS`| No       | Board polling seconds; positive int; default `30`      |

Test stubs set these via `vi.stubEnv` in `src/test-setup.ts` (which also polyfills `PointerEvent` / `ResizeObserver` and loads jest-dom).

## Testing

- Vitest (config embedded in `vite.config.ts`: jsdom, `globals: true`, alias `@` -> `./src`) + RTL + user-event.
- Co-locate `*.test.tsx` next to the source under test.
- Assert with accessible queries (`getByRole`, `getByText`) — not implementation details.
- Mock at the module boundary: `vi.mock` the `api/*` domain module being consumed (project convention), or stub the query hook. Never hit real network.
- Anything touching `DragDropContext` renders through `renderInDnd` from `src/test/dndWrapper.tsx`.
- Fake timers are explicit — required for timer/polling tests.
- Cover happy paths plus loading, error, and empty states.

## Build and Run

```bash
cd frontend
npm run dev          # Vite dev server (port 5173)
npm run build        # tsc -b && vite build
npm run preview      # Preview production build
npm run lint         # ESLint
npm run typecheck    # tsc -b
npm test             # vitest run

# From repo root
npm run test -w frontend -- src/components/TimerControls.test.tsx   # single test file
make dev                                                            # backend (:3000) + frontend (:5173)
make test-web                                                       # frontend tests only
make lint && make typecheck                                         # whole repo
make gate                                                           # full F50 merge gate
```

## Avoid

- Calling `fetch` directly or introducing any new HTTP/request library — everything goes through `api/client.ts` + `api/*.ts` modules.
- Adding a 4th Zustand store without justification.
- Component/styling libraries outside the Radix-based kit; reintroducing a JavaScript Tailwind configuration file.
- `any` (use `unknown` when truly unknown).
- Inline `style={{}}` (use Tailwind utilities / semantic tokens).
- Prop drilling past 2 levels (lift to a store or URL state).
- Premature `useMemo`/`useCallback` (optimize when measurable).
- Magic numbers (extract to `constants/`).
- `console.log` in production paths (surface errors via boundaries / toasts).
- Another form library beyond react-hook-form.
- Commenting out failing tests instead of fixing them.

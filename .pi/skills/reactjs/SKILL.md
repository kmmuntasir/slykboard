---
name: reactjs
description: Frontend coding conventions for the react-coder agent. The full reference — type safety, components, state, styling, API client, async, performance, naming, and the avoid-list.
---

# React + TypeScript Conventions

Reference skill for the `react-coder` agent. The full frontend coding standard. **The neighborhood wins over your defaults** — match what the codebase already does.

## Type safety

Explicit types everywhere — **no `any`** (use `unknown` when truly unknown). Explicit prop interfaces/types for every component. Respect the project's `tsconfig` strictness.

## Components

Functional components + hooks only. One component per file. Single responsibility. Early returns over nested branches. Keep components small where natural; extract reusable logic into custom hooks.

## State

- Local: `useState` / `useReducer`.
- Shared/global: the project's mechanism (React Context / Redux / Zustand).
- Server state: the project's data layer (e.g. TanStack Query).
- **Do not introduce a new state library — use what's there.**

## Styling

Use the project's approach — Tailwind / CSS Modules / styled-components / plain CSS / a UI kit. **No inline styles** unless the codebase uses them.

## API client / data fetching

Use the project's shared client and its interceptors (auth token, error handling). Service/API functions return typed data. Match existing request/response shapes exactly. Use the project's env-var convention for config (`import.meta.env.VITE_*`).

## Async

`async/await` — never raw promise chains. Handle errors with `try/catch` and the project's error type/logger (not `console.log` in production paths).

## Imports

Match the project's import order/grouping. Use `import type` for type-only imports if the project does.

## Performance

Optimize (`useMemo` / `useCallback`) only when measurably needed — no premature optimization. No magic numbers; name constants.

## Naming

- **Files:** PascalCase for components (`OfferCard.tsx`); camelCase `use*` for hooks (`useOffers.ts`); camelCase for utils; SCREAMING_SNAKE_CASE for constants.
- **Identifiers:** camelCase for variables/functions; PascalCase for components and types; keep acronyms consistent (URL, ID, HTTP, API) as the project does.

## Tests

Frontend stack: Vitest + Testing Library. Co-locate `*.test.tsx` next to source. Testing-Library priority: `getByRole` → `getByLabelText` → `getByText` → `getByTestId` (last resort).

## Avoid

`any`, `console.log` in production, premature `useMemo`/`useCallback`, magic numbers, prop drilling past what Context solves.

## No stubs, no TODOs, no "fill this in later."

Be self-contained — if something is ambiguous, surface the conflict explicitly in your final report instead of guessing.

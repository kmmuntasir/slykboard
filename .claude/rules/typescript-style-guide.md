# TypeScript Style Guide

## Formatting

- 2-space indent.
- Line length: 100 chars max (match ESLint/Prettier config).
- Semicolons: yes (match repo — see Prettier config).
- Quotes: single quotes (match repo).
- Imports: explicit, grouped — external, then internal/relative. Use `import type` for type-only imports.
- UTF-8 source encoding; LF line endings.

## Naming

- **Files** — PascalCase for components (`TicketCard.tsx`); camelCase `use*` for hooks (`useAuth.ts`); camelCase for modules (`apiClient.ts`); SCREAMING_SNAKE_CASE for constants files.
- **Interfaces / Types** — PascalCase: `TicketStatus`, `TicketPayload`.
- **Functions / variables** — camelCase: `fetchTickets`, `currentPosition`.
- **Constants** (`const X = ...`) — SCREAMING_SNAKE_CASE: `MAX_TICKET_TITLE_LENGTH`.
- **Enums/union types** — PascalCase types; string-literal unions preferred over `enum` where possible.
- **Acronyms** — consistent within the project (`URL`, `ID`, `API`).

## Type Design

- Prefer explicit interfaces over `any`. Use `unknown` when truly unknown, then narrow.
- Type all function params and return values; let inference fill obvious locals.
- Use union types (`'PROJECT_ADMIN' | 'MEMBER'`) over loose `string` for discriminated fields.
- Avoid `null` where `undefined` + optional chaining reads better — match project convention.
- Don't over-abstract generics; add them only when they earn their keep.

## React Components

- Functional components + hooks only. No class components.
- One component per file; explicit `XxxProps` interface exported.
- Early returns over nested branches.
- Extract reusable logic into custom hooks.

## Async & Errors

- `async`/`await` only — no raw promise chains, no ignored promises.
- Wrap API calls in try/catch; surface errors via the project's error type (`ApiClientError`) and UI.
- No `console.log` in production paths.

## Modules / Imports

- Barrel exports only where the project uses them (match `pages/`, `components/` convention).
- No unused imports — `tsc --noEmit` must pass.

## Avoid

- `any` (use `unknown`).
- `console.log`/`console.error` in production.
- Mutable exported singletons.
- `var`, string concatenation of SQL, magic numbers (extract to constants).
- Comments that restate what code does — comment only the *why* when non-obvious.
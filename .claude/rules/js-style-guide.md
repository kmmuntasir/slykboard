# JavaScript Style Guide

## Formatting

- Prettier for formatting (VS Code + ESLint integrated).
- Line length: 100 chars max.
- Indent: 4 spaces JSX, 2 spaces JavaScript.
- Trailing commas in arrays and objects.

## Naming Conventions

### Files
- Components: PascalCase (e.g., `TicketCard.tsx`, `BoardColumn.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useBoard.ts`, `useTimer.ts`)
- Utils: camelCase (e.g., `ticketUtils.ts`, `validation.ts`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `API_ENDPOINTS.ts`)

### Variables and Functions
- camelCase for variables and functions
- PascalCase for React components and TypeScript types/interfaces
- SCREAMING_SNAKE_CASE for constants

```typescript
// Components
function TicketCard() { }
interface Ticket { }

// Types
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL'

// Constants
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

// Variables
const currentColumn = 'in_progress'
```

### Acronyms
- Keep case consistent: `URL`, `ID`, `HTTP`, `API` (all caps)

## Code Structure

### Functions

- Keep short, focused (<50 lines).
- Early returns reduce nesting.
- async/await over raw promises.

```typescript
async function startTimer(ticketId: string): Promise<TimeEntry> {
    if (!ticketId) {
        throw new Error('Ticket ID is required')
    }

    const entry = await createTimeEntry(ticketId)
    return entry
}
```

### Error Handling

```typescript
try {
    const response = await fetchTickets(projectId)
    return response.json()
} catch (error) {
    console.error('Failed to fetch tickets:', error)
    throw new ApiError('Failed to fetch tickets')
}
```

### React Components

- Functional components with hooks.
- Extract reusable logic into custom hooks.
- Keep components single responsibility.

```typescript
export function TicketCard({ ticket, onMove }: TicketCardProps) {
    const [selected, setSelected] = useState<string | null>(null)

    const handleSelect = (label: string) => {
        setSelected(label)
        onMove(label)
    }

    return (
        <div className="ticket-card">
            <h2>{ticket.title}</h2>
            {ticket.labels.map(label => (
                <button key={label.id} onClick={() => handleSelect(label.id)}>
                    {label.text}
                </button>
            ))}
        </div>
    )
}
```

### Props Interface

Define explicit prop types:

```typescript
interface TicketCardProps {
    ticket: Ticket
    onMove: (labelId: string) => void
    disabled?: boolean
}
```

## Import Organization

Import order:

1. External libraries (React, React Query, Zustand, etc.)
2. Internal imports (components, hooks, utils)
3. Type imports
4. Relative imports

```typescript
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TicketCard } from '@/components/TicketCard'
import { useBoard } from '@/hooks/useBoard'
import type { Ticket } from '@/types'
import { API_ENDPOINTS } from '@/constants'
```

## Things to Avoid

- `any` — use explicit types or `unknown`
- `console.log` in production — use proper logger
- Inline styles — use Tailwind CSS classes
- Unnecessary `useMemo`/`useCallback` — optimize only when needed
- Magic numbers — define constants
- Prop drilling — use Zustand or React Context

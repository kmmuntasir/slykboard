# JavaScript Testing Rules

## Overview

Project use Vitest for testing (Vite-native test runner). Use Vitest for both unit and integration tests.

## Test Organization

```
frontend/src/
    components/
        TicketCard.tsx
        TicketCard.test.tsx    # Co-located with source
    hooks/
        useBoard.ts
        useBoard.test.ts
backend/
    routes/
        ticket.js
        ticket.test.js
```

Tests live alongside code they test, in `*.test.ts` or `*.test.js` files.

## Unit Tests

### Table-Driven Tests

Preferred pattern for most test scenarios:

```typescript
import { describe, it, expect } from 'vitest'
import { formatDuration } from './timeUtils'

describe('formatDuration', () => {
    const tests = [
        { name: 'whole hours', input: 90, expected: '1h 30m' },
        { name: 'minutes only', input: 45, expected: '45m' },
        { name: 'zero', input: 0, expected: '0m' },
    ]

    tests.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(formatDuration(input)).toBe(expected)
        })
    })
})
```

### Mocking

Use Vitest's built-in `vi.fn()` for mocks:

```typescript
const mockFetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ tickets: [] }) }))
global.fetch = mockFetch
```

For React components, use `@testing-library/react`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { TicketCard } from './TicketCard'

it('calls onMove when clicked', () => {
    const onMove = vi.fn()
    render(<TicketCard ticket={mockTicket} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onMove).toHaveBeenCalled()
})
```

## Integration Tests

Tests needing running backend should use build tags or environment checks:

```typescript
import { describe, it } from 'vitest'

describe('API integration', () => {
    it('fetches board', async () => {
        const response = await fetch('/api/projects/px/board')
        expect(response.ok).toBe(true)
    })
})
```

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage

# Specific file
npm test -- src/components/TicketCard.test.ts

# Run backend tests
npm test -- --root backend
```

## Best Practices

### Test Naming

- Test functions: `it('description')` or `test('description')`
- Describe groups: `describe('ComponentName')`

### Testing Library Priority

Use this priority order:
1. `getByRole` (most accessible)
2. `getByLabelText`
3. `getByText`
4. `getByTestId` (last resort)

### Assertions

Use Vitest's expect API:
- `expect(value).toBe(expected)`
- `expect(value).toEqual(expected)`
- `expect(value).toBeTruthy()`
- `expect(fn).toThrow()`

## Coverage Targets

- Business logic: >80%
- Components: >70%
- Integration: critical flows only

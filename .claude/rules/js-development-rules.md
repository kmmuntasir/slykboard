# Frontend Development Rules

## General

React 19+ frontend with Vite and Tailwind CSS. State via Zustand + React Query (TanStack Query). Drag-and-drop via `@hello-pangea/dnd`. Follow React official docs and Vite docs as primary references.

### Project Structure

```
frontend/
    src/
        components/     # React components
        hooks/          # Custom React hooks
        pages/          # Page components (Board, Reports, etc.)
        api/            # API client functions
        types/          # TypeScript types
        constants/      # App constants
        utils/          # Utility functions
        stores/         # Zustand stores
    index.html
    vite.config.ts
    tailwind.config.js
```

### Component Conventions

- One component per file
- Co-locate test files next to components
- Use explicit prop interfaces
- Use functional components with hooks

### State Management

- React Query (TanStack Query) for server state (board polling/caching at 30s interval)
- Zustand for client/global UI state
- useState for local component state

### API Client

Use fetch or axios with proper error handling:

```typescript
async function fetchBoard(projectId: string): Promise<Board> {
    const response = await fetch(`${API_BASE_URL}/projects/${projectId}/board`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch board: ${response.statusText}`)
    }

    return response.json()
}
```

### Environment Variables

Prefix with `VITE_` for client-side access:

```
VITE_API_BASE_URL=https://your-api.onrender.com/api
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

### Deployment (Frontend)

- Deploy on **Vercel** (or self-host via Docker per PRD)
- Build command: `npm run build`
- Publish directory: `dist`
- Set environment variables in Vercel dashboard

---

# Backend Development Rules

## General

Node.js 24+ with Express.js 5. Follow Express docs as primary reference.

### Project Structure

```
backend/
    src/
        routes/         # API route handlers
        controllers/    # Request/response handling
        middleware/     # Express middleware (auth, error, validation)
        services/       # Business logic
        repositories/   # Data-access layer (Prisma/Drizzle/pg)
        db/             # Migrations & schema
        utils/          # Utility functions
        config/         # App config (env, oauth)
        index.js        # Entry point
    package.json
```

### Route Conventions

- RESTful naming (`/api/projects/:id/board`, `/api/tickets/:id/timer/start`)
- Use proper HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Return JSON responses with a consistent envelope

### Middleware

```javascript
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
        return res.status(401).json({ error: 'Missing token' })
    }
    next()
}
```

### Database

PostgreSQL via the project's client (Prisma / Drizzle / raw `pg`). Supabase usable as a hosted Postgres provider.

```javascript
async function getTickets(projectId, column) {
    return prisma.ticket.findMany({
        where: { projectId, statusColumn: column },
        orderBy: { createdAt: 'asc' },
    })
}
```

### Environment Configuration

All config via environment variables:

| Variable | Required | Default |
|---|---|---|
| `PORT` | No | `3000` |
| `FRONTEND_URL` | Yes | — |
| `DATABASE_URL` | Yes | — |
| `GOOGLE_CLIENT_ID` | Yes | — |
| `GOOGLE_CLIENT_SECRET` | Yes | — |
| `GOOGLE_CALLBACK_URL` | Yes | — |
| `JWT_SECRET` | Yes | — |
| `ALLOWED_DOMAIN` | No | — (G-Suite workspace restriction) |
| `POLL_INTERVAL_SECONDS` | No | `30` |

### Deployment (Backend)

- Deploy on **Render** (or self-host via Docker per PRD)
- Build command: `npm install`
- Start command: `node src/index.js`
- Set environment variables in Render dashboard

### Security

- Validate all inputs (Zod/Joi at the edge)
- Use parameterized queries / ORM query builder — never string-concat SQL
- No secrets in code — all via environment variables
- CORS configured for specific frontend URL only
- Auth enforced via middleware; roles (Admin/Member) via a permission middleware

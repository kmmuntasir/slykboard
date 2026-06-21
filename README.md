# slykboard
An open-source, minimal Kanban board with built-in time tracking and reporting. Built for small teams. Lightweight alternative to enterprise task trackers with zero bloat.

## Development

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm (ships with Node)

### Getting Started

```bash
# Switch to the correct Node version
nvm use

# Install dependencies for all workspaces (run at repo root)
npm install
```

`npm install` at the repo root installs dependencies for both `frontend/` and `backend/` workspaces once they exist.

### Running the App

```bash
# Boot backend (:3000) and frontend (:5173) concurrently with namespaced logs
npm run dev
```

### Per-Package Scripts

```bash
npm run dev -w frontend     # Vite dev server only
npm run dev -w backend      # API dev server only
npm run test                # Run tests in all workspaces
npm run lint                # Lint the whole monorepo
npm run typecheck           # Typecheck all workspaces
```

### Environment Setup

Copy the example env files and fill in real values. The real `.env` files are gitignored; `.env.example` files are tracked.

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

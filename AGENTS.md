# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: Next.js 15 app (App Router).
  - `app/`: route pages (`dashboard`, `leaderboard`, `settings`, `auth/callback`)
  - `components/`: shared UI (e.g., sidebar)
  - `lib/`: API helpers and client utilities
  - `public/`: static assets
- `backend/`: Go API service (Gin + PostgreSQL access in `main.go` for now).
- `deploy/`: deployment-related assets (`postgres/init.sql`).
- `docker-compose.yml`: local full-stack orchestration (`frontend`, `backend`, `db`).

## Build, Test, and Development Commands
- `docker compose up --build`: build and run full stack locally.
- `docker compose down`: stop all services.
- `cd frontend && npm install && npm run dev`: run frontend only on `:3000`.
- `cd frontend && npm run build && npm run start`: production-like frontend run.
- `cd backend && go run main.go`: run backend only on `:8080`.
- `cd backend && go test ./...`: run backend tests (add tests as modules grow).

## Coding Style & Naming Conventions
- **Go**: use `gofmt` formatting, short focused functions, explicit error handling.
- **TypeScript/React**: strict typing preferred; avoid `any` unless justified.
- Indentation: 2 spaces in frontend files, tabs in Go files (gofmt default).
- Naming:
  - React components: `PascalCase` (`Sidebar.tsx`)
  - utility/modules: `camelCase` or short nouns (`api.ts`)
  - route folders: lowercase (`app/dashboard`)

## Testing Guidelines
- Frontend: add component/integration tests when introducing non-trivial UI logic.
- Backend: table-driven tests for handlers, auth middleware, and RCON command guards.
- Test file naming:
  - Go: `*_test.go`
  - Frontend: `*.test.ts(x)` colocated or under `__tests__/`.
- Minimum expectation for PRs: tests for new logic paths and regression-prone fixes.

## Commit & Pull Request Guidelines
- Git history is not available in this workspace; use **Conventional Commits**:
  - `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Keep commits scoped and atomic (one concern per commit).
- PRs should include:
  - concise summary and motivation
  - changed areas (`frontend`, `backend`, `deploy`)
  - test evidence (command output or screenshots for UI changes)
  - config/env updates required for reviewers

## Security & Configuration Tips
- Do not commit real secrets; keep runtime secrets in `.env` files.
- Validate admin scope via `ADMIN_STEAM_IDS`; never expose free-form RCON execution to guests.
- Review CORS and callback URLs before production deployment.

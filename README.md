# CSGO Community Server Control Panel

Full-stack panel for community CSGO servers:
- `frontend`: Next.js dashboard UI
- `backend`: Go + Gin API server
- `db`: PostgreSQL

## Features (v1)
- Steam OpenID login
- Roles: `guest` / `admin`
- Dashboard with:
  - `steam://connect` join button
  - server runtime status
  - in-match player table
- Leaderboard (total wins / total KD)
- Personal settings (in-game nickname)
- Admin RCON actions:
  - kick player
  - change map
  - change game mode
- RCON audit logs

## Run with Docker Compose
1. Edit env files:
   - `backend/.env.example`
   - `frontend/.env.example`
2. Start stack:
   - `docker compose up --build`
3. Open:
   - Frontend: `http://localhost:3000`
   - Backend health: `http://localhost:8080/healthz`

## Deployment
- Split frontend/backend deployment guide: `docs/DEPLOY_SEPARATE_SERVERS.md`
- Quick two-server deployment (with scripts): `docs/DEPLOY_QUICK_TWO_SERVERS.md`
- API reference: `docs/API_REFERENCE.md`

## Key environment variables (backend)
- `DATABASE_URL`
- `JWT_SECRET`
- `STEAM_REALM`
- `STEAM_RETURN_TO`
- `FRONTEND_AUTH_CALLBACK_URL`
- `ADMIN_STEAM_IDS` (comma-separated SteamID64 list)
- `RCON_HOST`
- `RCON_PASSWORD`
- `MATCH_SSH_HOST`
- `MATCH_SSH_PORT`
- `MATCH_SSH_USER`
- `MATCH_SSH_KEY_PATH`
- `MATCH_REMOTE_GET5_DIR`
- `MATCH_SERVER_RESTART_CMD`

## Key environment variables (frontend)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_MATCHES_USE_MOCK` (`true` for mock, `false` for backend API)

## API Overview
- `GET /api/v1/auth/steam/login`
- `GET /api/v1/auth/steam/callback`
- `GET /api/v1/me`
- `PATCH /api/v1/me/nickname`
- `GET /api/v1/dashboard/server-status`
- `GET /api/v1/dashboard/match-live`
- `GET /api/v1/leaderboard`
- `POST /api/v1/admin/rcon/kick`
- `POST /api/v1/admin/rcon/change-map`
- `POST /api/v1/admin/rcon/change-mode`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/matches`
- `GET /api/v1/matches/:id`
- `POST /api/v1/matches/:id/join`
- `POST /api/v1/matches/:id/draft/pick`
- `POST /api/v1/matches/:id/veto/action`
- `POST /api/v1/admin/matches`
- `POST /api/v1/admin/matches/:id/open`
- `POST /api/v1/admin/matches/:id/force-start`
- `POST /api/v1/admin/matches/:id/captains`
- `POST /api/v1/admin/matches/:id/launch`
- `POST /api/v1/admin/matches/:id/finish`

# Contributing to DockerChat

Small, well-tested changes are welcome. Open an issue with the problem, expected behavior, reproduction steps, and your OS/runtime versions. Do not attach `.env`, private keys, chat history, or dashboard database exports.

## Local setup

Clone the repository and run `python tools/setup_env.py`. Keep `.env` private. The easiest complete development environment is `docker compose up --build -d`.

For frontend work, use Node.js 24+: `npm --prefix client ci`, then `npm --prefix client run dev`. The Vite development server needs the API host/port values from `.env`; copy only the relevant `VITE_*` values into `client/.env.local` if running Vite outside Docker. Do not copy server credentials into client environment files.

For backend work, install Bun, run `bun install --frozen-lockfile` from `backend-servers/server`, and start `bun run index.ts` with the needed Redis/service variables. Redis fallback is in-memory and is not shared between backend replicas. Service environment variables are supplied automatically by Compose; outside Compose, supply them in your shell.

For dashboard work, create a Python virtual environment and install `dashboard/requirements.txt`. Set `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and optionally `DASHBOARD_DATABASE_PATH` to a writable local SQLite path before starting `dashboard/app.py`. The dashboard also uses the configured Redis address and the container shared-log paths.

## Before a pull request

Run the checks documented in the main README. For Go code, use `go test ./...` inside `firewall/` on Linux: the service uses Linux socket options. For Compose changes, generate local configuration and run `docker compose config --quiet`, followed by a real container smoke test when Docker is available.

Add regression tests for behavior changes. Explain the user-visible change, how you verified it, and any remaining limitations. Keep formatting changes separate from functional changes where practical. Preserve existing authorship, licenses, and data attributions.

Cryptographic wire changes must update client and server together, include compatibility/tamper tests, and document migration. Do not describe a new primitive or protocol as production-safe based solely on unit tests.

## Useful entry points

- `tests/auth.test.mjs`: complete-payload signatures, replay handling, browser/server compatibility.
- `tests/command-handler.test.ts`: authenticated key updates, malformed commands, encrypted payload handling.
- `tests/test_dashboard.py`: explicit credentials, password handling, local redirects, non-destructive setup.

The regular checks workflow has read-only repository permissions. VPS deployment requires a separate manual workflow dispatch; a contribution must not need deployment credentials.

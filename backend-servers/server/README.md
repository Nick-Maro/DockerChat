# DockerChat WebSocket backend

Bun + TypeScript command handling, signed browser identities, Redis persistence, and an in-memory fallback. The [root README](../../README.md) is the supported entry point for running the whole system.

```sh
bun install --frozen-lockfile
bun run index.ts
```

Compose supplies environment variables from the root `.env`. When running directly, supply `SERVER_PORT` (default 5000), `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `REDIS_DB` in your shell. `DEBUG=TRUE` enables diagnostics; `FALSE` disables them.

`GET /status` exposes service metrics. Chat commands arrive over WebSocket and, apart from initial public-key registration, must be signed. Browser and backend must use the same complete-payload canonical JSON signature format. ECDH key updates require authentication and can only update the authenticated identity.

Run `bun test tests/command-handler.test.ts` from the repository root after installing backend dependencies. See [SECURITY.md](../../SECURITY.md) for the current trust model and deployment limits.

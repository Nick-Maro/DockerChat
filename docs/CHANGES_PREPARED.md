# Changes prepared locally

Base: `771617bc06dbb61a9f3da14629deb524ad9de678` from `Nick-Maro/DockerChat`.
Branch: `prepare/github-ready`. Changes are committed locally for review and have not been pushed.

The preparation is organized into focused commits for local configuration,
dashboard authentication, signed message payloads, private-message handling,
dependency updates, proxy/container behavior, deployment privacy, continuous
integration, and contributor documentation. The previous unpublished combined
commit is preserved only on a local backup branch and is not part of the publish plan.

## Presentation and onboarding

- Replaced the outdated README/clone URL with a project introduction, actual service topology, quick start, configuration details, contribution paths, and an explicit educational security model.
- Added CONTRIBUTING, SECURITY, issue forms, a PR template, CI, line-ending rules, and Docker build-context exclusions.
- Added a standard-library configuration generator that creates independent random secrets and refuses to replace an existing `.env`.
- Preserved the MIT license, author credits, and bundled word-list attribution.

## Correctness and security fixes

- Browser and server now sign complete canonical JSON payloads, including recipients, content, and key-update fields. Invalid signatures do not consume nonces; malformed signature inputs fail closed.
- ECDH key updates require authentication and ownership. Socket identities are associated only after authentication; unsigned ping messages cannot claim another identity.
- Private text/files fail if an encryption key is unavailable. Files previously marked encrypted while carrying plaintext are actually encrypted and decrypted for display/history.
- Key fingerprints hash raw key material rather than publishing a prefix of it. Private files include sender public-key metadata for key refresh.
- Attachment rendering accepts base64 data URLs only, uses inert download MIME types, and restricts inline image previews. Large buffers encode in chunks, and the WebSocket limit accommodates a fully encrypted 10 MiB file.
- Only the original sender may delete a private message. Replies retain their metadata after persistence, and colons in private text are preserved.
- Removed duplicate dashboard authentication definitions that reintroduced default credentials and printed passwords. Fixed failed-bootstrap SQLite cleanup, local-only login redirects, and disabled the Flask debugger.
- Disabled shared API response caching. Fixed proxy health probes and missing curl, backend DEBUG parsing, SERVER_PORT handling, supported Bun backpressure options, and strict TypeScript errors without relaxing compiler settings.
- Compose host ports default to loopback. The VPS deployment workflow is manual, so a later push does not automatically redeploy it.
- Deployment host, SSH username, checkout path, key, and trusted host keys are supplied through environment secrets. Local private keys, credential exports, and browser captures are ignored by Git.
- Updated the client lockfile and dashboard dependencies; installs in Docker use their lockfiles.

## Verification

- Node authentication/browser compatibility regressions: **9 passed**.
- Bun command, ownership, persistence, cryptography, attachment safety/size regressions: **13 passed**.
- Python dashboard/authentication/configuration regressions: **8 passed**.
- Client and backend TypeScript checks: passed.
- Client Vite production build: passed.
- Client `npm audit`: **0 findings** in the installed dependency set at verification time.
- Python syntax compilation and `git diff --check`: passed.
- A redacted Gitleaks scan found no credentials in the current source or reachable commit history; local runtime/dependency folders were excluded from the publishable tree scan.

The protocol was independently reviewed by another agent; the fingerprint, file key refresh, wire-size, and attachment-URL findings were corrected and covered by targeted checks.

## Limits before publication/deployment

Docker and Go executables were unavailable in this environment. The complete Compose stack, real browser-to-browser conversations, TLS path, and Linux Go compilation were therefore not run locally. CI includes Compose configuration validation and a Linux Go build/test step, but has not run remotely because no push was performed.

Browser and backend must be upgraded together: old metadata-only signatures are intentionally rejected. Refresh previously open clients. The project still has no independent cryptographic audit, shared multi-replica replay cache, peer-key verification, dashboard CSRF protections/roles, or production WSGI server. These limits are stated in the public README and SECURITY document.

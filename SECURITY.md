# Security model

DockerChat is an educational prototype, not an audited secure messenger. Please use non-sensitive test data.

## Current boundaries

- RSA/SHA-256 signatures cover the complete canonical JSON command payload. Nonces and timestamps reject replays within one backend process. The replay cache is not shared between replicas and is lost on restart.
- Private messages and private file content use browser-side ECDH P-256 and AES-GCM. The browser refuses to send them when a shared key cannot be obtained. Room messages and room files are plaintext to the backend.
- Peer public keys are distributed by the server. There is no independent identity verification, key-transparency service, forward-secrecy protocol, or protection against a malicious server replacing peer keys. File names, types, identities, timestamps, and other metadata remain visible.
- Browser identity/signing keys and ECDH material persist in local browser storage. An XSS compromise or access to that profile can expose them. Clearing browser data can make old conversations unreadable.
- The dashboard can inspect and modify operational data. Dashboard accounts currently share administrative capabilities. Fine-grained roles, comprehensive CSRF protection, login rate limits, and a production WSGI deployment remain open work.
- Compose binds host ports to loopback by default. Internal Docker networks are not a substitute for application authorization. The optional Go filter is a separate endpoint and is bypassed by the default direct reverse-proxy URLs.
- API responses are not cached by NGINX. The Flask debugger is disabled. Initial dashboard credentials must be explicitly supplied; configuration generation creates independent random values.

## Reporting a vulnerability

Do not post exploitable details, passwords, keys, or user data in public issues. If GitHub private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** action. Otherwise, use a private contact method shown on the maintainer's GitHub profile and share a minimal reproduction using test data.

This project has no guaranteed response SLA or supported release policy yet. Security-related patches should include regression coverage and any protocol/client migration steps.

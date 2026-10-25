# DockerChat documentation

This Next.js/Fumadocs site explains the educational DockerChat lab. The
[repository README](../README.md) and [security model](../SECURITY.md) describe
the current implementation and quick start.

## Develop locally

```sh
cd docs
npm ci
npm run dev
```

Open `http://localhost:3000`. Edit `content/docs/` for the guides,
`app/(home)/page.tsx` for the landing page, and `app/layout.tsx` for search/share
metadata. The original architecture preview is in `public/dockerchat-overview.svg`.
Its PNG export provides a 1200×630 sharing image; it contains no real conversations
or credentials.

## Check a change

```sh
npm run build:local
```

The build creates a static site under `out/`. The YAML helper may create `.backup`
files when normalizing older frontmatter; keep generated output and backups out
of a source commit. The GitHub documentation workflow builds changes under
`docs/` and publishes the resulting site through GitHub Pages.

For a GitHub project Pages build, set `NEXT_PUBLIC_BASE_PATH=/DockerChat` before
building. The workflow gets this prefix from the Pages configuration; local
development leaves the variable unset. Asset URLs and Next.js links retain the
prefix, so the same site works locally and at the repository's Pages URL.

When adding a guide, use its `/docs/...` route in documentation links rather than
the source `.mdx` filename. Keep security claims aligned with `SECURITY.md`, and
use original diagrams or synthetic examples instead of private operational data.

## Dependency scope

Run `npm audit` from this directory when maintaining the documentation toolchain;
the chat client's audit does not cover this separate lockfile. The site is exported
as static files, rather than deployed as a Next.js application server. Remaining
advisories in the older Fumadocs/Next.js and Mermaid dependency chains require a
coordinated major-version migration; do not apply `npm audit fix --force` without
checking that the guides and static export still work.

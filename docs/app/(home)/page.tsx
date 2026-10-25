import Link from 'next/link';

export default function HomePage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-full max-w-5xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Self-hosted chat · Docker Compose · Network-security lab
        </p>
        <h1 className="mb-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
          Start a conversation.<br />Explore the network behind it.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
          DockerChat brings a Preact client, Bun WebSocket API, Redis, NGINX,
          a Go traffic filter, and a Flask dashboard into one educational lab.
        </p>
        <div className="mb-10 flex flex-wrap justify-center gap-3">
          <Link href="/docs" className="inline-block rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
            Start the local lab →
          </Link>
          <a href="https://github.com/Nick-Maro/DockerChat" className="inline-block rounded-xl border border-border px-6 py-3 font-semibold hover:bg-muted">
            Explore the source
          </a>
        </div>
        {/* An architecture diagram, not a screenshot of a deployed conversation. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${basePath}/dockerchat-overview.svg`} width="1200" height="630" alt="DockerChat service architecture, including the separate optional traffic-filter endpoint" className="w-full rounded-2xl border border-border" />
        <p className="mx-auto mt-6 max-w-2xl text-sm text-muted-foreground">
          Educational prototype. Public rooms are visible to the server; peer keys
          are server-distributed and the protocol is not independently audited.
          Use synthetic conversations and read the security model.
        </p>
      </div>
    </main>
  );
}

import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="bg-background/70 backdrop-blur-md rounded-2xl shadow-lg p-8 max-w-md w-full border border-border">
        <h1 className="mb-4 text-3xl font-extrabold tracking-tight text-foreground">
          Welcome!
        </h1>
        <p className="mb-6 text-muted-foreground">
          Explore the{' '}
          <span className="font-semibold text-foreground">/docs</span>{' '}
          section to read the documentation.
        </p>
        <Link
          href="/docs"
          className="inline-block px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold shadow-md hover:opacity-90 transition-all"
        >
          Open Documentation →
        </Link>
      </div>
    </main>
  );
}

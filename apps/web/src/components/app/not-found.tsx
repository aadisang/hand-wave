export function NotFound() {
  return (
    <main className="dark flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          404
        </p>
        <h1 className="font-semibold text-2xl">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a
          className="mt-2 inline-flex h-action items-center justify-center rounded-md border border-border bg-card px-4 text-sm transition-colors hover:bg-accent"
          href="/"
        >
          Back to home
        </a>
      </div>
    </main>
  );
}
